import type { Pool } from "pg";

export interface DiffResult {
  repostCount: number;
  daysOpen: number;
  descriptionChurn: number;
}

export interface ComputeDiffInput {
  source: string;
  externalId: string;
  runId: string;
  rawRowId: string;
  fetchedAt: Date;
  title: string;
  description: string;
  // Greenhouse only -- decision 040/043. undefined for Lever, which has no
  // equivalent field.
  requisitionId?: string;
  openedAt: Date;
  // Each adapter knows its own raw_response shape; computeDiffs.ts stays
  // source-agnostic (one shared place for the comparison/repost logic,
  // per CLAUDE.md's "one place per score/computation" discipline) by asking
  // the caller how to pull title/description back out of a historical row.
  extractText: (rawResponse: unknown) => { title: string; description: string };
}

interface HistoryRow {
  fetched_at: string;
  raw_response: unknown;
}

const MS_PER_DAY = 86_400_000;

// Greenhouse's `content` field is HTML-entity-escaped (literal
// "&lt;div class=&quot;...&quot;&gt;"), not raw markup -- verified live
// against boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true during
// this story (06_decisions/044). Lever's `description` is raw HTML.
// Decoding entities first means one strip-tags pass handles both sources.
const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&lt;|&gt;|&amp;|&quot;|&#39;|&nbsp;/g, (match) => HTML_ENTITIES[match]);
}

// Boundary from 06_decisions/044: a whitespace-only reflow or an HTML
// re-serialization (attribute order, &nbsp; vs a plain space) must not
// count as churn. Case is deliberately preserved -- a capitalization
// rewrite ("URGENT") is a real, intentional edit, not upstream noise.
export function normalizeChurnText(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/**
 * Was this requisition_id already seen under a DIFFERENT external_id before
 * this fetch? Greenhouse-only signal (06_decisions/043) for the "same
 * requisition reopened under a new job id" pattern absence-based detection
 * can't see, since the old external_id may never come back at all.
 */
async function hasPriorRequisitionIdSighting(
  pool: Pool,
  source: string,
  externalId: string,
  requisitionId: string,
  beforeFetchedAt: Date,
): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM raw_requisitions
      WHERE source = $1
        AND external_id != $2
        AND fetched_at < $3
        AND raw_response ->> 'requisition_id' = $4`,
    [source, externalId, beforeFetchedAt.toISOString(), requisitionId],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Was this source polled (any OTHER external_id got a row) at some point
 * strictly between `from` and `to`, without `externalId` itself appearing?
 * That's the real "the board was checked and this item wasn't there"
 * signal absence-based repost detection needs (06_decisions/043) -- a bare
 * fetched_at gap on the item's own rows can't distinguish "board polled,
 * item absent" from "board simply not polled again" on its own.
 */
async function wasPolledWithoutThisItem(
  pool: Pool,
  source: string,
  externalId: string,
  from: Date,
  to: Date,
): Promise<boolean> {
  const { rows } = await pool.query<{ run_id: string }>(
    `SELECT DISTINCT run_id
       FROM raw_requisitions
      WHERE source = $1
        AND external_id != $2
        AND run_id IS NOT NULL
        AND fetched_at > $3
        AND fetched_at < $4`,
    [source, externalId, from.toISOString(), to.toISOString()],
  );
  return rows.length > 0;
}

/**
 * Pure function of raw_requisitions history (plus this fetch's already-
 * persisted current row) -- deterministic and re-derivable
 * (06_decisions/043's trust guarantee): the same raw_requisitions state
 * always produces the same repost_count/days_open/description_churn,
 * regardless of how many times or in what order this is re-run.
 *
 * Called inline by each provider, right after persistRawRequisition() and
 * before building that item's MarketSignal -- not a later, separate pass --
 * so the corrected daysOpen/isRepost actually reach scoreSignal()/
 * hardToFillScore() this same run (see 06_decisions/043's architecture
 * note). Neither scorer changes; only what feeds them does.
 */
export async function computeDiff(pool: Pool, input: ComputeDiffInput): Promise<DiffResult> {
  const { rows: priorRows } = await pool.query<HistoryRow>(
    `SELECT fetched_at, raw_response
       FROM raw_requisitions
      WHERE source = $1 AND external_id = $2 AND id != $3
      ORDER BY fetched_at ASC`,
    [input.source, input.externalId, input.rawRowId],
  );

  if (priorRows.length === 0) {
    // First sighting of this external_id: nothing has "disappeared" yet, so
    // absence-based repost detection can't fire. The requisition_id-based
    // signal can, though -- a genuinely new external_id reusing an older
    // requisition_id is exactly the "reopened under a new job id" pattern.
    const repostCount =
      input.requisitionId &&
      (await hasPriorRequisitionIdSighting(pool, input.source, input.externalId, input.requisitionId, input.fetchedAt))
        ? 1
        : 0;

    return {
      repostCount,
      daysOpen: daysBetween(input.openedAt, input.fetchedAt),
      descriptionChurn: 0,
    };
  }

  const history: { fetchedAt: Date; title: string; description: string }[] = priorRows.map((row) => {
    const extracted = input.extractText(row.raw_response);
    return {
      fetchedAt: new Date(row.fetched_at),
      title: normalizeChurnText(extracted.title),
      description: normalizeChurnText(extracted.description),
    };
  });
  history.push({
    fetchedAt: input.fetchedAt,
    title: normalizeChurnText(input.title),
    description: normalizeChurnText(input.description),
  });

  let repostCount = 0;
  let descriptionChurn = 0;

  // Cumulative totals across the FULL history, not just "did this one fetch
  // change something" -- both columns are running counts, and re-deriving
  // them from scratch every time (rather than reading a stored counter and
  // incrementing it) is what makes the trust guarantee (section 9) hold.
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];

    if (await wasPolledWithoutThisItem(pool, input.source, input.externalId, prev.fetchedAt, curr.fetchedAt)) {
      repostCount += 1;
    }

    if (curr.title !== prev.title || curr.description !== prev.description) {
      descriptionChurn += 1;
    }
  }

  return {
    repostCount,
    daysOpen: daysBetween(input.openedAt, input.fetchedAt),
    descriptionChurn,
  };
}
