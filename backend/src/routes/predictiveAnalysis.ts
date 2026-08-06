import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { computeForecast } from "../scoring/demandForecast";

interface PlacementsRow {
  month: string;
  count: number;
}

/**
 * S-13 (REQ-007) — the ScoringAgent forecast boundary. This route does no
 * forecasting math itself: it reads the same "placements per month" series
 * analytics.ts (S-12, 06_decisions/020) already reads, then hands it to
 * computeForecast(), the one place that math lives (06_decisions/021).
 * Read-only; REQ-020's human-release gate doesn't apply here — nothing this
 * route does writes to a client CRM or leaves the platform.
 */
export function predictiveAnalysisRouter(pool: Pool): Router {
  const router = Router();

  router.post("/predictive-analysis/forecast", requireAuth, async (req, res) => {
    const startedAt = Date.now();
    try {
      // Identical query to analytics.ts's placementsPerMonth — same
      // definition of "demand" (06_decisions/021), not a second one.
      const { rows } = await pool.query(
        `SELECT to_char(changed_at, 'YYYY-MM') AS month, count(*)::int AS count
         FROM sales_pipeline_audit
         WHERE to_stage = 'closed'
         GROUP BY month
         ORDER BY month`,
      );

      const series = (rows as PlacementsRow[]).map((row) => ({ month: row.month, count: row.count }));
      const result = computeForecast(series);

      // AC-4-8's 10s target is generous and measured, not enforced with a
      // hard timeout here: the only I/O is one Postgres query already bounded
      // by pool.ts's statement_timeout (5s), which satisfies CLAUDE.md rule 8
      // without a redundant per-route wrapper.
      logger.info(
        {
          correlationId: req.correlationId,
          status: result.status,
          durationMs: Date.now() - startedAt,
        },
        "demand forecast computed",
      );
      res.status(200).json(result);
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "demand forecast failed");
      res.status(500).json({ error: "failed to compute forecast" });
    }
  });

  return router;
}
