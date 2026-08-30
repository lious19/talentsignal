import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawRequisition } from "../ingestion/rawRequisitions";
import { computeDiff } from "../ingestion/computeDiffs";
import { logger } from "../logger";

const SOURCE = "lever";

// Shape confirmed against real, live postings (gopuff, leverdemo) during
// S-21's design research. Unlike Greenhouse, a Lever posting carries no
// company name -- the board handle (config, not the response) is the only
// source for it. salaryRange is optional and jurisdiction-dependent; none
// of the real postings fetched during research had it, but the field is
// checked defensively rather than assumed absent everywhere. `description`
// (S-22): Lever's default response already includes raw HTML description
// text -- confirmed in the gopuff fixture -- unlike Greenhouse, no query
// param change was needed for this source (06_decisions/044). Lever has no
// requisition_id-equivalent field, so the requisition_id-based repost
// signal (06_decisions/043) is Greenhouse-only.
interface LeverPosting {
  id: string;
  text: string;
  createdAt: number;
  salaryRange?: unknown;
  description?: string;
}

function parseDate(epochMs: number, fieldName: string): Date {
  if (typeof epochMs !== "number" || Number.isNaN(epochMs)) {
    throw new Error(`unparseable ${fieldName} timestamp: ${JSON.stringify(epochMs)}`);
  }
  return new Date(epochMs);
}

function displayCompanyName(handle: string): string {
  return handle
    .split(/[-_]/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

// Lets computeDiffs.ts pull title/description back out of a HISTORICAL
// raw_response row without knowing Lever's shape itself (06_decisions/043).
function extractText(rawResponse: unknown): { title: string; description: string } {
  const posting = rawResponse as Partial<LeverPosting> | null;
  return { title: posting?.text ?? "", description: posting?.description ?? "" };
}

async function toMarketSignal(
  pool: Pool,
  handle: string,
  posting: LeverPosting,
  runId: string,
  rawRowId: string,
  fetchedAt: Date,
): Promise<MarketSignal> {
  const openedAt = parseDate(posting.createdAt, "createdAt");

  // S-22: same wiring as GreenhouseProvider -- see 06_decisions/043/044/045.
  const diff = await computeDiff(pool, {
    source: SOURCE,
    externalId: posting.id,
    runId,
    rawRowId,
    fetchedAt,
    title: posting.text,
    description: posting.description ?? "",
    openedAt,
    extractText,
  });

  return {
    source: SOURCE,
    externalId: posting.id,
    company: displayCompanyName(handle),
    title: posting.text,
    daysOpen: diff.daysOpen,
    isRepost: diff.repostCount > 0,
    hasSalaryRange: posting.salaryRange != null,
    repostCount: diff.repostCount,
    descriptionChurn: diff.descriptionChurn,
  };
}

/**
 * Implements the existing MarketSignalProvider contract directly, same as
 * GreenhouseProvider -- see 06_decisions/040. Per-board (per-company-handle)
 * isolation lives here: one bad handle in LEVER_COMPANIES must not blank
 * out another handle's real postings (acceptance criterion 4).
 */
export class LeverProvider implements MarketSignalProvider {
  constructor(
    private readonly pool: Pool,
    private readonly companyHandles: string[],
  ) {}

  async fetchSignals(options: FetchSignalsOptions): Promise<MarketSignal[]> {
    const signals: MarketSignal[] = [];
    const runId = options.runId ?? randomUUID();

    for (const handle of this.companyHandles) {
      let postings: LeverPosting[];
      try {
        postings = await this.fetchCompany(handle, options.timeoutMs);
      } catch (err) {
        logger.error(
          { source: SOURCE, board: handle, err },
          "lever company fetch failed",
        );
        continue;
      }

      for (const posting of postings) {
        // Raw persisted before parsing -- acceptance criterion 2. Wrapping
        // only the parse step below (now including the S-22 diff
        // computation) means one bad posting's raw response still survives
        // and doesn't stop the next posting in the same company from being
        // fetched-and-persisted (see 06_decisions/040's trust guarantee).
        const rawRow = await persistRawRequisition(this.pool, SOURCE, posting.id, posting, 200, runId);
        try {
          signals.push(await toMarketSignal(this.pool, handle, posting, runId, rawRow.id, rawRow.fetchedAt));
        } catch (err) {
          logger.error(
            { source: SOURCE, board: handle, externalId: posting.id, err },
            "lever posting parse failed; raw response was already persisted",
          );
        }
      }
    }

    return signals;
  }

  private async fetchCompany(handle: string, timeoutMs: number): Promise<LeverPosting[]> {
    const res = await fetchWithTimeout(
      `https://api.lever.co/v0/postings/${encodeURIComponent(handle)}?mode=json`,
      timeoutMs,
    );
    if (!res.ok) {
      throw new Error(`lever company "${handle}" responded ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new Error(`lever company "${handle}" returned an unexpected shape`);
    }
    return body as LeverPosting[];
  }
}
