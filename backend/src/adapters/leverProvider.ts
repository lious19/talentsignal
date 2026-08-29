import type { Pool } from "pg";
import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawRequisition } from "../ingestion/rawRequisitions";
import { logger } from "../logger";

const SOURCE = "lever";

// Shape confirmed against real, live postings (gopuff, leverdemo) during
// S-21's design research. Unlike Greenhouse, a Lever posting carries no
// company name -- the board handle (config, not the response) is the only
// source for it. salaryRange is optional and jurisdiction-dependent; none
// of the real postings fetched during research had it, but the field is
// checked defensively rather than assumed absent everywhere.
interface LeverPosting {
  id: string;
  text: string;
  createdAt: number;
  salaryRange?: unknown;
}

function daysSince(epochMs: number): number {
  if (typeof epochMs !== "number" || Number.isNaN(epochMs)) {
    throw new Error(`unparseable createdAt timestamp: ${JSON.stringify(epochMs)}`);
  }
  return Math.max(0, Math.floor((Date.now() - epochMs) / 86_400_000));
}

function displayCompanyName(handle: string): string {
  return handle
    .split(/[-_]/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function toMarketSignal(handle: string, posting: LeverPosting): MarketSignal {
  return {
    source: SOURCE,
    externalId: posting.id,
    company: displayCompanyName(handle),
    title: posting.text,
    daysOpen: daysSince(posting.createdAt),
    // Deferred to S-22, same as GreenhouseProvider -- see 06_decisions/040.
    isRepost: false,
    hasSalaryRange: posting.salaryRange != null,
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
        // only the parse step below means one bad posting's raw response
        // still survives and doesn't stop the next posting in the same
        // company from being fetched-and-persisted (see 06_decisions/040's
        // trust guarantee).
        await persistRawRequisition(this.pool, SOURCE, posting.id, posting, 200);
        try {
          signals.push(toMarketSignal(handle, posting));
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
