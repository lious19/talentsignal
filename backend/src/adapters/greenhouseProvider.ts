import type { Pool } from "pg";
import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawRequisition } from "../ingestion/rawRequisitions";
import { logger } from "../logger";

const SOURCE = "greenhouse";

// Shape confirmed against real, live boards (gitlab, figma, vercel) during
// S-21's design research -- not guessed. Greenhouse's public jobs endpoint
// does not expose compensation data on any job actually fetched, so
// hasSalaryRange is always false for this source (see toMarketSignal below,
// and 06_decisions/040).
interface GreenhouseJob {
  id: number | string;
  title: string;
  company_name: string;
  first_published: string;
  updated_at: string;
}

interface GreenhouseBoardResponse {
  jobs: GreenhouseJob[];
}

function daysSince(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    throw new Error(`unparseable first_published date: ${JSON.stringify(isoDate)}`);
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function toMarketSignal(job: GreenhouseJob): MarketSignal {
  return {
    source: SOURCE,
    externalId: String(job.id),
    company: job.company_name,
    title: job.title,
    daysOpen: daysSince(job.first_published),
    // Deferred to S-22 (longitudinal diffing) by design -- neither
    // Greenhouse nor Lever expose an explicit repost flag on a single
    // fetch. See 06_decisions/040.
    isRepost: false,
    hasSalaryRange: false,
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
        // job: the try/catch wraps parsing only, so one bad job's raw
        // response survives, and it doesn't stop the next job in the same
        // board from being fetched-and-persisted too (see 06_decisions/040's
        // trust guarantee).
        await persistRawRequisition(this.pool, SOURCE, String(job.id), job, 200);
        try {
          signals.push(toMarketSignal(job));
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
    const res = await fetchWithTimeout(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
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
