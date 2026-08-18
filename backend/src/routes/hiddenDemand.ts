import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import type { MarketSignal, MarketSignalProvider } from "../adapters/marketSignalProvider";
import { scoreSignal, type ScoreFactor } from "../scoring/confidenceScore";
// HF-2: a SECOND, independent scorer surfaced alongside confidence. Importing
// it here (not folding it into scoreSignal) keeps "one place per score" — see
// 06_decisions/026. HARD_TO_FILL_CONFIG.hardToFillThreshold is the badge cutoff.
import { hardToFillScore, type HardToFillFactor } from "../scoring/hardToFillScore";
import { HARD_TO_FILL_CONFIG } from "../scoring/hardToFillConfig";

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
  title: string;
  confidence_score: string;
  reasons: string[];
  weights_version: string;
  factor_breakdown: ScoreFactor[];
  // HF-2: the hard-to-fill columns migration 013 added, mirroring the
  // confidence quartet above. Independent score, independent version.
  hard_to_fill_score: string;
  hard_to_fill_reasons: string[];
  hard_to_fill_factors: HardToFillFactor[];
  hard_to_fill_version: string;
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
    title: row.title,
    confidenceScore: Number(row.confidence_score),
    reasons: row.reasons,
    weightsVersion: row.weights_version,
    factors: row.factor_breakdown,
    // HF-2: hardToFill is the derived badge boolean — true only when the score
    // clears the PROPOSED threshold (026). The score/reasons/factors ride
    // along so the UI can show the "why" and never render a bare badge
    // (HF-2 trust scenario). pg returns NUMERIC as a string, so Number() here
    // exactly like confidence_score above.
    hardToFill: Number(row.hard_to_fill_score) >= HARD_TO_FILL_CONFIG.hardToFillThreshold,
    hardToFillScore: Number(row.hard_to_fill_score),
    hardToFillReasons: row.hard_to_fill_reasons,
    hardToFillFactors: row.hard_to_fill_factors,
    hardToFillVersion: row.hard_to_fill_version,
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
 * Scores (confidence + hard-to-fill) and upserts a whole batch in ONE
 * statement via unnest(), not one `pool.query` per signal. That distinction is
 * the entire latency story here: Postgres also caps a query at 65535 bind
 * parameters, and a dynamically built multi-VALUES statement (11 columns *
 * 10,000 rows = 110,000 params) sits over that ceiling at the exact scale this
 * story targets. unnest() takes one array parameter per column — 11 array
 * params (plus one scalar delimiter) total, regardless of whether the batch
 * has 1 row or 10,000 — and stays a single atomic statement, so a batch either
 * fully upserts or fully fails, never half-applies.
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
  const titles: string[] = [];
  const scores: number[] = [];
  const reasonsJoined: string[] = [];
  const weightsVersions: string[] = [];
  const breakdownsJson: string[] = [];
  // HF-2: parallel arrays for the second score. Same U+001F delimiter trick as
  // reasons (TEXT[] can't ride through unnest un-joined — see REASONS_DELIMITER
  // above). factors go in as one jsonb value per row, like factor_breakdown.
  const htfScores: number[] = [];
  const htfReasonsJoined: string[] = [];
  const htfBreakdownsJson: string[] = [];
  const htfVersions: string[] = [];

  for (const signal of signals) {
    const { score, reasons, factors, weightsVersion } = scoreSignal(signal);
    // Second, independent scorer over the SAME signal — computed alongside,
    // never inside, scoreSignal(). scoreSignal stays untouched (026).
    const htf = hardToFillScore(signal);
    sources.push(signal.source);
    externalIds.push(signal.externalId);
    companies.push(signal.company);
    titles.push(signal.title);
    scores.push(score);
    reasonsJoined.push(reasons.join(REASONS_DELIMITER));
    weightsVersions.push(weightsVersion);
    breakdownsJson.push(JSON.stringify(factors));
    htfScores.push(htf.score);
    htfReasonsJoined.push(htf.reasons.join(REASONS_DELIMITER));
    htfBreakdownsJson.push(JSON.stringify(htf.factors));
    htfVersions.push(htf.version);
  }

  const { rows } = await pool.query(
    `INSERT INTO opportunities
       (source, external_signal_id, company, title, confidence_score, reasons, weights_version, factor_breakdown,
        hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors, hard_to_fill_version)
     SELECT
       src.source,
       src.external_signal_id,
       src.company,
       src.title,
       src.confidence_score,
       string_to_array(src.reasons_joined, $13),
       src.weights_version,
       src.factor_breakdown,
       src.hard_to_fill_score,
       string_to_array(src.htf_reasons_joined, $13),
       src.hard_to_fill_factors,
       src.hard_to_fill_version
     FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::jsonb[],
                 $8::numeric[], $9::text[], $10::jsonb[], $11::text[], $12::text[])
       AS src(source, external_signal_id, company, confidence_score, reasons_joined, weights_version, factor_breakdown,
              hard_to_fill_score, htf_reasons_joined, hard_to_fill_factors, hard_to_fill_version, title)
     ON CONFLICT (source, external_signal_id)
     DO UPDATE SET confidence_score = EXCLUDED.confidence_score,
                   title = EXCLUDED.title,
                   reasons = EXCLUDED.reasons,
                   weights_version = EXCLUDED.weights_version,
                   factor_breakdown = EXCLUDED.factor_breakdown,
                   hard_to_fill_score = EXCLUDED.hard_to_fill_score,
                   hard_to_fill_reasons = EXCLUDED.hard_to_fill_reasons,
                   hard_to_fill_factors = EXCLUDED.hard_to_fill_factors,
                   hard_to_fill_version = EXCLUDED.hard_to_fill_version,
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
      htfScores,
      htfReasonsJoined,
      htfBreakdownsJson,
      htfVersions,
      titles,
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

  // S-04: "As a sales rep..." — 06_decisions/022's permission matrix.
  router.post("/hidden-demand/analyze", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
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

  router.get("/hidden-demand/opportunities", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
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
