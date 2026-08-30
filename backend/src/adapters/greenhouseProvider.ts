import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawRequisition } from "../ingestion/rawRequisitions";
import { computeDiff } from "../ingestion/computeDiffs";
import { logger } from "../logger";

const SOURCE = "greenhouse";

// Shape confirmed against real, live boards (gitlab, figma, vercel) during
// S-21's design research -- not guessed. Greenhouse's public jobs endpoint
// does not expose compensation data on any job actually fetched, so
// hasSalaryRange is always false for this source (see toMarketSignal below,
// and 06_decisions/040). `content` (S-22): only present because
// fetchBoard() now requests `?content=true` -- verified live during this
// story (06_decisions/044) that the default response omits it entirely.
interface GreenhouseJob {
  id: number | string;
  title: string;
  company_name: string;
  first_published: string;
  updated_at: string;
  requisition_id?: string;
  content?: string;
}

interface GreenhouseBoardResponse {
  jobs: GreenhouseJob[];
}

function parseDate(isoDate: string, fieldName: string): Date {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    throw new Error(`unparseable ${fieldName} date: ${JSON.stringify(isoDate)}`);
  }
  return new Date(parsed);
}

// Lets computeDiffs.ts pull title/description back out of a HISTORICAL
// raw_response row without knowing Greenhouse's shape itself (06_decisions/043).
function extractText(rawResponse: unknown): { title: string; description: string } {
  const job = rawResponse as Partial<GreenhouseJob> | null;
  return { title: job?.title ?? "", description: job?.content ?? "" };
}

async function toMarketSignal(
  pool: Pool,
  job: GreenhouseJob,
  runId: string,
  rawRowId: string,
  fetchedAt: Date,
): Promise<MarketSignal> {
  const openedAt = parseDate(job.first_published, "first_published");

  // S-22: daysOpen/isRepost are now measured from raw_requisitions history,
  // not seeded from a single fetch (06_decisions/043/044/045) -- computed
  // BEFORE this MarketSignal is built, and BEFORE scoreSignal()/
  // hardToFillScore() ever see it, so both scorers get real inputs with
  // zero changes to either function.
  const diff = await computeDiff(pool, {
    source: SOURCE,
    externalId: String(job.id),
    runId,
    rawRowId,
    fetchedAt,
    title: job.title,
    description: job.content ?? "",
    requisitionId: job.requisition_id,
    openedAt,
    extractText,
  });

  return {
    source: SOURCE,
    externalId: String(job.id),
    company: job.company_name,
    title: job.title,
    daysOpen: diff.daysOpen,
    isRepost: diff.repostCount > 0,
    hasSalaryRange: false,
    repostCount: diff.repostCount,
    descriptionChurn: diff.descriptionChurn,
  };
}

/**
 * Implements the existing MarketSignalProvider contract directly (no
 * interface change -- see 06_decisions/040): the only thing that changes
 * for a real provider is what happens inside fetchSignals(), never the
 * shape callers depend on.
 *
 * Per-board isolation lives here, inside the provider, not just at the
 * ingestRequisitions.ts orchestrator level: GREENHOUSE_BOARDS can list
 * several tokens, and one bad token must not blank out every other
 * token's real postings (acceptance criterion 4).
 */
export class GreenhouseProvider implements MarketSignalProvider {
  constructor(
    private readonly pool: Pool,
    private readonly boardTokens: string[],
  ) {}

  async fetchSignals(options: FetchSignalsOptions): Promise<MarketSignal[]> {
    const signals: MarketSignal[] = [];
    const runId = options.runId ?? randomUUID();

    for (const token of this.boardTokens) {
      let jobs: GreenhouseJob[];
      try {
        jobs = await this.fetchBoard(token, options.timeoutMs);
      } catch (err) {
        logger.error(
          { source: SOURCE, board: token, err },
          "greenhouse board fetch failed",
        );
        continue;
      }

      for (const job of jobs) {
        // Raw persisted before parsing -- acceptance criterion 2. This
        // happens even if toMarketSignal() below throws for this specific
        // job: the try/catch wraps parsing (now including the S-22 diff
        // computation) only, so one bad job's raw response survives, and it
        // doesn't stop the next job in the same board from being
        // fetched-and-persisted too (see 06_decisions/040's trust guarantee).
        const rawRow = await persistRawRequisition(this.pool, SOURCE, String(job.id), job, 200, runId);
        try {
          signals.push(await toMarketSignal(this.pool, job, runId, rawRow.id, rawRow.fetchedAt));
        } catch (err) {
          logger.error(
            { source: SOURCE, board: token, externalId: String(job.id), err },
            "greenhouse job parse failed; raw response was already persisted",
          );
        }
      }
    }

    return signals;
  }

  private async fetchBoard(token: string, timeoutMs: number): Promise<GreenhouseJob[]> {
    // S-22: `content=true` added (06_decisions/044) -- without it,
    // Greenhouse's board list endpoint returns no description text at all,
    // verified live against boards-api.greenhouse.io during this story,
    // which would make description_churn silently title-only for this
    // source. Confirmed the response otherwise adds only new fields
    // (content, departments, offices, ai_disclaimer, ...) -- nothing this
    // adapter already reads changed shape.
    const res = await fetchWithTimeout(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
      timeoutMs,
    );
    if (!res.ok) {
      throw new Error(`greenhouse board "${token}" responded ${res.status}`);
    }
    const body = (await res.json()) as GreenhouseBoardResponse;
    if (!Array.isArray(body.jobs)) {
      throw new Error(`greenhouse board "${token}" returned an unexpected shape`);
    }
    return body.jobs;
  }
}
