import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { CapacitySignal, FetchCapacitySignalsOptions, CapacitySignalProvider } from "./capacitySignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawCapacitySignal } from "../ingestion/rawCapacitySignals";
import { logger } from "../logger";

const SOURCE = "federal-award";
const SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const AWARD_TYPE_CODES = ["A", "B", "C", "D"]; // contracts

interface SpendingByAwardResult {
  "Recipient Name": string | null;
  generated_internal_id: string;
}

interface SpendingByAwardResponse {
  results: SpendingByAwardResult[];
}

interface AwardDetailResponse {
  period_of_performance?: { start_date?: string | null } | null;
  recipient?: { recipient_name?: string | null } | null;
}

async function searchAwardsForCompany(
  companyName: string,
  timeoutMs: number,
): Promise<SpendingByAwardResult[]> {
  // S-24 / Step 0's exact gotcha: `keywords` searches award DESCRIPTION text
  // (returns companies whose contracts merely MENTION this company, e.g. a
  // reseller). `recipient_search_text` is the correct filter for "is this
  // company the actual recipient" -- confirmed against real data in Step 0.
  const res = await fetchWithTimeout(SEARCH_URL, timeoutMs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        recipient_search_text: [companyName],
        time_period: [{ start_date: "2007-10-01", end_date: new Date().toISOString().slice(0, 10) }],
        award_type_codes: AWARD_TYPE_CODES,
      },
      // sort must be one of the requested `fields` -- USASpending 400s
      // otherwise ("Sort value 'Award Amount' not found in requested
      // fields"), a real bug this exact line had until Step 5b's live run
      // caught it (unit tests with a mocked fetch never exercise the real
      // API's validation). Sorting by Award ID is arbitrary but stable;
      // order doesn't matter for our purposes since match counts are small
      // (limit 10) and every result gets used, not just the top one.
      fields: ["Award ID", "Recipient Name"],
      page: 1,
      limit: 10,
      sort: "Award ID",
      order: "desc",
    }),
  });
  if (!res.ok) {
    throw new Error(`usaspending search for "${companyName}" responded ${res.status}`);
  }
  const body = (await res.json()) as SpendingByAwardResponse;
  if (!Array.isArray(body.results)) {
    throw new Error(`usaspending search for "${companyName}" returned an unexpected shape`);
  }
  return body.results;
}

// S-24 / Step 0 finding: the search endpoint's own "Period of Performance
// Start Date" field comes back null for every real result -- the real,
// populated value only exists on the per-award detail endpoint. One extra
// call per matched award (never per search -- match counts are small, ≤10
// per company by construction of the search `limit` above).
async function fetchAwardDetail(
  generatedInternalId: string,
  timeoutMs: number,
): Promise<AwardDetailResponse> {
  const res = await fetchWithTimeout(
    `https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(generatedInternalId)}/`,
    timeoutMs,
  );
  if (!res.ok) {
    throw new Error(`usaspending award detail for "${generatedInternalId}" responded ${res.status}`);
  }
  return (await res.json()) as AwardDetailResponse;
}

/**
 * S-24: federal contract awards as a capacity signal -- company-level only
 * (no occupation data, 06_decisions/047), sourceStrength 0.6. Per-company
 * isolation mirrors GreenhouseProvider/LeverProvider (06_decisions/040): one
 * company's search failing doesn't blank out another's real results.
 */
export class FederalAwardsProvider implements CapacitySignalProvider {
  constructor(
    private readonly pool: Pool,
    private readonly targetCompanyNames: string[],
  ) {}

  async fetchSignals(options: FetchCapacitySignalsOptions): Promise<CapacitySignal[]> {
    const signals: CapacitySignal[] = [];
    const runId = options.runId ?? randomUUID();

    for (const companyName of this.targetCompanyNames) {
      let results: SpendingByAwardResult[];
      try {
        results = await searchAwardsForCompany(companyName, options.timeoutMs);
      } catch (err) {
        logger.error({ source: SOURCE, companyName, err }, "federal awards search failed");
        continue;
      }

      // Detail calls for this company's matched awards, batched together --
      // not sequential, and isolated from other companies' searches above.
      const detailResults = await Promise.all(
        results.map(async (result) => {
          try {
            const detail = await fetchAwardDetail(result.generated_internal_id, options.timeoutMs);
            return { result, detail, err: undefined as unknown };
          } catch (err) {
            return { result, detail: undefined, err };
          }
        }),
      );

      for (const { result, detail, err } of detailResults) {
        if (err || !detail) {
          logger.error(
            { source: SOURCE, companyName, awardId: result.generated_internal_id, err },
            "federal award detail fetch failed; award skipped (search result already logged)",
          );
          continue;
        }

        const employerNameRaw = detail.recipient?.recipient_name ?? result["Recipient Name"] ?? companyName;
        const eventDate = detail.period_of_performance?.start_date ?? null;

        await persistRawCapacitySignal(
          this.pool,
          SOURCE,
          employerNameRaw,
          eventDate,
          undefined,
          undefined,
          detail,
          200,
          runId,
        );
        signals.push({ source: SOURCE, employerNameRaw, eventDate });
      }
    }

    return signals;
  }
}
