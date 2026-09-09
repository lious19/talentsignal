import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { HARD_TO_FILL_CONFIG } from "../scoring/hardToFillConfig";

interface OpportunityAggRow {
  total: string;
  hard_to_fill: string;
  measured_basis: string;
  curated_basis: string;
  source_excluded: string;
}

export interface OpportunitySummary {
  total: number;
  hardToFill: number;
  measuredBasis: number;
  curatedBasis: number;
  noBasis: number;
  sourceExcluded: number;
  totalClients: number;
  totalCandidates: number;
  totalRequisitionsIngested: number;
  generatedAt: string;
}

// S-24 (Fix 1): the tile counts both Overview and Opportunities need are one
// cheap aggregate query each, computed here once instead of every screen
// pulling the full opportunities table and re-filtering it on every render
// (the "Opportunities screen lags" complaint). No snapshot table, same
// live-compute convention as analytics.ts (06_decisions/020) — this route
// just adds a short cache in front of it, see below.
const SUMMARY_CACHE_TTL_MS = 30_000;
let cachedSummary: { data: OpportunitySummary; expiresAt: number } | undefined;

// measuredBasis/curatedBasis: 06_decisions/046's real basis taxonomy on the
// roleScarcity factor, not an invented proxy. noBasis is deliberately the
// arithmetic remainder (total - measuredBasis - curatedBasis), not a third
// JSONB query -- that guarantees the three tiers always sum to `total`
// exactly, including for hard-to-fill-026-v1 rows (pre-S-23) whose
// roleScarcity factor has no `basis` key at all: they match neither JSONB
// condition below and fall into the remainder, which is where they belong.
async function computeSummary(pool: Pool): Promise<OpportunitySummary> {
  const [oppResult, clientsResult, candidatesResult, rawReqResult] = await Promise.all([
    pool.query<OpportunityAggRow>(
      `SELECT
         count(*) FILTER (WHERE source != 'seed-job-board') AS total,
         count(*) FILTER (WHERE source != 'seed-job-board' AND hard_to_fill_score >= $1) AS hard_to_fill,
         count(*) FILTER (WHERE source != 'seed-job-board' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(hard_to_fill_factors) e
           WHERE e->>'factor' = 'roleScarcity' AND e->>'basis' = 'measured'
         )) AS measured_basis,
         count(*) FILTER (WHERE source != 'seed-job-board' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(hard_to_fill_factors) e
           WHERE e->>'factor' = 'roleScarcity' AND e->>'basis' = 'curated'
         )) AS curated_basis,
         count(*) FILTER (WHERE source = 'seed-job-board') AS source_excluded
       FROM opportunities`,
      [HARD_TO_FILL_CONFIG.hardToFillThreshold],
    ),
    pool.query("SELECT count(*)::int AS count FROM clients"),
    pool.query("SELECT count(*)::int AS count FROM candidates"),
    pool.query("SELECT count(*)::int AS count FROM raw_requisitions"),
  ]);

  const agg = oppResult.rows[0];
  const total = Number(agg.total);
  const measuredBasis = Number(agg.measured_basis);
  const curatedBasis = Number(agg.curated_basis);

  return {
    total,
    hardToFill: Number(agg.hard_to_fill),
    measuredBasis,
    curatedBasis,
    noBasis: total - measuredBasis - curatedBasis,
    sourceExcluded: Number(agg.source_excluded),
    totalClients: clientsResult.rows[0].count,
    totalCandidates: candidatesResult.rows[0].count,
    totalRequisitionsIngested: rawReqResult.rows[0].count,
    generatedAt: new Date().toISOString(),
  };
}

export function opportunitySummaryRouter(pool: Pool): Router {
  const router = Router();

  // Same gate as GET /hidden-demand/opportunities -- this is a rollup over
  // the same data, so it can't be visible to anyone that route wouldn't
  // already show it to.
  router.get("/opportunities/summary", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    try {
      const now = Date.now();
      if (!cachedSummary || cachedSummary.expiresAt <= now) {
        const data = await computeSummary(pool);
        cachedSummary = { data, expiresAt: now + SUMMARY_CACHE_TTL_MS };
      }

      logger.info({ correlationId: req.correlationId }, "opportunity summary served");
      res.status(200).json(cachedSummary.data);
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunity summary computation failed");
      res.status(500).json({ error: "failed to compute opportunity summary" });
    }
  });

  return router;
}
