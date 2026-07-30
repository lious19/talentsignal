import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import type { MarketSignal, MarketSignalProvider } from "../adapters/marketSignalProvider";
import { scoreSignal, type ScoreFactor } from "../scoring/confidenceScore";

// The mock does no real I/O, but the timeout is real regardless: it bounds
// how long a hung or slow provider (mock or, later, a real HTTP call) can
// block this request, per CLAUDE.md rule 8.
const PROVIDER_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`provider timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export interface OpportunityRow {
  id: string;
  source: string;
  external_signal_id: string;
  company: string;
  confidence_score: string;
  reasons: string[];
  weights_version: string;
  factor_breakdown: ScoreFactor[];
  created_at: string;
  updated_at: string;
}

// pg returns NUMERIC columns as strings (to avoid silent precision loss), so
// confidence_score needs an explicit conversion back to a number here.
// factor_breakdown is JSONB, which pg parses automatically — no JSON.parse
// needed, unlike confidence_score.
//
// Exported so the new opportunities.ts route (S-07) shapes rows the same
// way this route always has — one function producing the response shape,
// not two that could drift.
export function toOpportunityResponse(row: OpportunityRow) {
  return {
    id: row.id,
    company: row.company,
    confidenceScore: Number(row.confidence_score),
    reasons: row.reasons,
    weightsVersion: row.weights_version,
    factors: row.factor_breakdown,
    source: row.source,
    externalSignalId: row.external_signal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Ranked by confidence descending; external_signal_id (unique, stable) is the
// tiebreak, not created_at — a batch insert can give many rows the exact same
// now(), which would make equal-score ordering nondeterministic and flake the
// idempotency test.
function byRankThenId(
  a: ReturnType<typeof toOpportunityResponse>,
  b: ReturnType<typeof toOpportunityResponse>,
): number {
  if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
  return a.externalSignalId < b.externalSignalId ? -1 : a.externalSignalId > b.externalSignalId ? 1 : 0;
}

// reasons is TEXT[] in Postgres, but unnest() can't walk a scalar array
// (source, external_signal_id, ...) and a nested array (reasons) in lockstep
// as one row per index — unnest flattens a 2-D array into individual
// elements, not sub-arrays per row. So each row's reasons are joined into one
// string with a delimiter before the query, and split back into a real array
// inside SQL (string_to_array). U+001F (Unit Separator) is the ASCII control
// character reserved for exactly this — joining sub-elements of one field —
// so it can't collide with anything scoreSignal() actually writes into a
// reason ("reposted role", "no salary range", ...).
const REASONS_DELIMITER = "\u001F";

/**
 * Scores and upserts a whole batch in ONE statement via unnest(), not one
 * `pool.query` per signal. That distinction is the entire latency story here:
 * Postgres also caps a query at 65535 bind parameters, and a dynamically
 * built multi-VALUES statement (7 columns * 10,000 rows = 70,000 params)
 * sits close enough to that ceiling to be a real risk at the exact scale this
 * story targets. unnest() takes one array parameter per column — 7 params
 * total, regardless of whether the batch has 1 row or 10,000 — and stays a
 * single atomic statement, so a batch either fully upserts or fully fails,
 * never half-applies.
 *
 * factor_breakdown needs no delimiter trick the way reasons does: each row's
 * breakdown is ONE jsonb value (an array of 4 factor objects), not several
 * sub-elements that unnest() would otherwise flatten across rows — so a
 * plain jsonb[] array, one parsed JSON document per row, is unambiguous.
 */
async function upsertBatch(
  pool: Pool,
  signals: MarketSignal[],
): Promise<ReturnType<typeof toOpportunityResponse>[]> {
  if (signals.length === 0) return [];

  const sources: string[] = [];
  const externalIds: string[] = [];
  const companies: string[] = [];
  const scores: number[] = [];
  const reasonsJoined: string[] = [];
  const weightsVersions: string[] = [];
  const breakdownsJson: string[] = [];

  for (const signal of signals) {
    const { score, reasons, factors, weightsVersion } = scoreSignal(signal);
    sources.push(signal.source);
    externalIds.push(signal.externalId);
    companies.push(signal.company);
    scores.push(score);
    reasonsJoined.push(reasons.join(REASONS_DELIMITER));
    weightsVersions.push(weightsVersion);
    breakdownsJson.push(JSON.stringify(factors));
  }

  const { rows } = await pool.query(
    `INSERT INTO opportunities
       (source, external_signal_id, company, confidence_score, reasons, weights_version, factor_breakdown)
     SELECT
       src.source,
       src.external_signal_id,
       src.company,
       src.confidence_score,
       string_to_array(src.reasons_joined, $8),
       src.weights_version,
       src.factor_breakdown
     FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::jsonb[])
       AS src(source, external_signal_id, company, confidence_score, reasons_joined, weights_version, factor_breakdown)
     ON CONFLICT (source, external_signal_id)
     DO UPDATE SET confidence_score = EXCLUDED.confidence_score,
                   reasons = EXCLUDED.reasons,
                   weights_version = EXCLUDED.weights_version,
                   factor_breakdown = EXCLUDED.factor_breakdown,
                   updated_at = now()
     RETURNING *`,
    [
      sources,
      externalIds,
      companies,
      scores,
      reasonsJoined,
      weightsVersions,
      breakdownsJson,
      REASONS_DELIMITER,
    ],
  );

  return (rows as OpportunityRow[]).map(toOpportunityResponse).sort(byRankThenId);
}

export function hiddenDemandRouter(
  pool: Pool,
  provider: MarketSignalProvider,
  options?: { providerTimeoutMs?: number },
): Router {
  const providerTimeoutMs = options?.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
  const router = Router();

  router.post("/hidden-demand/analyze", requireAuth, async (req, res) => {
    let signals;
    try {
      signals = await withTimeout(
        provider.fetchSignals({ timeoutMs: providerTimeoutMs }),
        providerTimeoutMs,
      );
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "hidden-demand provider call failed");
      const isTimeout = err instanceof Error && err.message.includes("timed out");
      res
        .status(isTimeout ? 504 : 502)
        .json({ error: isTimeout ? "provider timed out" : "provider unavailable" });
      return;
    }

    try {
      const opportunities = await upsertBatch(pool, signals);

      logger.info(
        { correlationId: req.correlationId, count: opportunities.length },
        "hidden-demand analyze completed",
      );
      res.status(201).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "hidden-demand analyze failed");
      res.status(500).json({ error: "analyze failed" });
    }
  });

  router.get("/hidden-demand/opportunities", requireAuth, async (req, res) => {
    try {
      // Seed rows (source = 'seed-job-board', see SeedJobBoardProvider) are
      // synthetic test data used to demo ranking and measure AC-4-2 latency —
      // hidden from the board by default so they never look like real
      // opportunities. ?includeSeedData=true opts back in for local/demo use.
      const includeSeedData = req.query.includeSeedData === "true";
      const { rows } = await pool.query(
        includeSeedData
          ? "SELECT * FROM opportunities"
          : "SELECT * FROM opportunities WHERE source != 'seed-job-board'",
      );
      const opportunities = rows.map((row) => toOpportunityResponse(row as OpportunityRow)).sort(byRankThenId);
      res.status(200).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list opportunities failed");
      res.status(500).json({ error: "failed to list opportunities" });
    }
  });

  return router;
}
