import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { ANOMALY_CONFIG } from "../scoring/anomalyConfig";
import { classifyAnomalies, type AnomalyClassification } from "../scoring/revenueAnomaly";
import { SEGMENTATION_CONFIG } from "../scoring/segmentationConfig";
import { segmentClients } from "../scoring/clientSegmentation";

// GET stays admin/sales/recruiter — the same "agency manager" viewer set
// analytics.ts's own dashboard is wired behind in App.tsx (06_decisions/022).
// POST /decide is narrower (admin/sales only): it mutates the SHARED
// anomaly_thresholds row, the same write-guard precedent S-16 set for
// crm write/rollback. Both confirmed explicitly for S-17 (06_decisions/025).
const VIEW_ROLES = ["admin", "sales", "recruiter"];
const DECIDE_ROLES = ["admin", "sales"];

interface PlacementsRow {
  month: string;
  count: number;
}

interface ThresholdRow {
  metric: string;
  k_std_dev: string;
  updated_at: string;
}

interface DecisionRow {
  month: string;
  step: "confirmed" | "suppressed";
}

interface ClientRow {
  id: string;
  name: string;
}

interface OpenRolesRow {
  client_id: string;
  open_roles: number;
}

function isValidMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function isValidDecision(value: unknown): value is "confirmed" | "suppressed" {
  return value === "confirmed" || value === "suppressed";
}

async function fetchPlacementsSeries(db: Pick<Pool, "query">): Promise<{ month: string; count: number }[]> {
  // Identical query to analytics.ts's/predictiveAnalysis.ts's placements
  // series — same definition of the revenue proxy everywhere it's read, not
  // a second one (06_decisions/025).
  const { rows } = await db.query<PlacementsRow>(
    `SELECT to_char(changed_at, 'YYYY-MM') AS month, count(*)::int AS count
     FROM sales_pipeline_audit
     WHERE to_stage = 'closed'
     GROUP BY month
     ORDER BY month`,
  );
  return rows.map((row) => ({ month: row.month, count: row.count }));
}

async function loadDecisions(
  db: Pick<Pool, "query">,
  metric: string,
): Promise<Map<string, "confirmed" | "suppressed">> {
  // Latest human action per (metric, month) — the exact DISTINCT ON idiom
  // opportunityRelationships.ts already established for S-10's confirm/dismiss
  // status, reused here rather than a second mutable "current status" table
  // that could drift out of sync with the audit trail.
  const { rows } = await db.query<DecisionRow>(
    `SELECT DISTINCT ON (month) month, step FROM anomaly_audit
     WHERE metric = $1 ORDER BY month, recorded_at DESC`,
    [metric],
  );
  const byMonth = new Map<string, "confirmed" | "suppressed">();
  for (const row of rows) byMonth.set(row.month, row.step);
  return byMonth;
}

export function revenueAnomaliesRouter(pool: Pool): Router {
  const router = Router();

  // The verbatim slice: GET /api/analytics/anomalies -> AnomalyFlagged ->
  // flagged revenue anomalies and client segments. Read-only, side-effect-free
  // — no "flagged" event is ever written, only the two human actions below are.
  router.get("/analytics/anomalies", requireAuth, requireRole(VIEW_ROLES), async (req, res) => {
    const startedAt = Date.now();
    try {
      const metric = ANOMALY_CONFIG.metric;

      const [series, thresholdResult, decisions, clientsResult, openRolesResult] = await Promise.all([
        fetchPlacementsSeries(pool),
        pool.query<ThresholdRow>("SELECT * FROM anomaly_thresholds WHERE metric = $1", [metric]),
        loadDecisions(pool, metric),
        pool.query<ClientRow>("SELECT id, name FROM clients ORDER BY name"),
        pool.query<OpenRolesRow>(
          `SELECT client_id, count(*)::int AS open_roles FROM job_openings GROUP BY client_id`,
        ),
      ]);

      const kStdDev =
        thresholdResult.rows.length === 0 ? ANOMALY_CONFIG.baseKStdDev : Number(thresholdResult.rows[0].k_std_dev);
      const thresholdUpdatedAt = thresholdResult.rows.length === 0 ? null : thresholdResult.rows[0].updated_at;

      const classification = classifyAnomalies(series, kStdDev);
      const anomalies =
        classification.status === "insufficient-history"
          ? classification
          : {
              status: "ok" as const,
              metric,
              residualStd: classification.residualStd,
              threshold: { kStdDev, updatedAt: thresholdUpdatedAt },
              points: classification.points.map((point) => ({
                ...point,
                decision: decisions.get(point.month) ?? "unconfirmed",
              })),
            };

      const openRoleCounts = new Map(openRolesResult.rows.map((row) => [row.client_id, row.open_roles]));
      const groups = segmentClients(clientsResult.rows, openRoleCounts);

      logger.info(
        { correlationId: req.correlationId, status: classification.status, durationMs: Date.now() - startedAt },
        "revenue anomalies + segmentation computed",
      );
      res.status(200).json({
        anomalies,
        segments: { dimension: SEGMENTATION_CONFIG.dimension, groups },
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "revenue anomalies computation failed");
      res.status(500).json({ error: "failed to compute anomalies" });
    }
  });

  // The trust scenario (S-17's own 🛡): a human can confirm or suppress a
  // flagged point, and suppression makes the threshold "learn" — kStdDev
  // widens by ANOMALY_CONFIG.suppressionStepStdDev, capped at maxKStdDev.
  // Confirming is record-only (06_decisions/025) — it proves the point was
  // reviewed without changing future sensitivity.
  router.post("/analytics/anomalies/decide", requireAuth, requireRole(DECIDE_ROLES), async (req, res) => {
    const month = req.body?.month;
    const decision = req.body?.decision;
    const metric = ANOMALY_CONFIG.metric;

    if (!isValidMonth(month)) {
      res.status(400).json({ error: "month must be in YYYY-MM format" });
      return;
    }
    if (!isValidDecision(decision)) {
      res.status(400).json({ error: "decision must be 'confirmed' or 'suppressed'" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Same advisory-lock idea as salesPipeline.ts's update handler: a row
      // lock can't protect a threshold row that doesn't exist yet on a
      // metric's very first suppression, so this serializes concurrent
      // decide() calls for the same metric directly, before either one has
      // read a (possibly absent) anomaly_thresholds row.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [metric]);

      const series = await fetchPlacementsSeries(client);
      const { rows: thresholdRows } = await client.query<ThresholdRow>(
        "SELECT * FROM anomaly_thresholds WHERE metric = $1",
        [metric],
      );
      const kStdDevBefore =
        thresholdRows.length === 0 ? ANOMALY_CONFIG.baseKStdDev : Number(thresholdRows[0].k_std_dev);

      const classification: AnomalyClassification = classifyAnomalies(series, kStdDevBefore);
      if (classification.status === "insufficient-history") {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "insufficient history to classify this point" });
        return;
      }

      const point = classification.points.find((p) => p.month === month);
      if (!point || !point.isAnomaly) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "that point is not currently flagged as an anomaly" });
        return;
      }

      const detail: Record<string, unknown> = {
        residual: point.residual,
        residualStd: classification.residualStd,
        kStdDevBefore,
      };

      let kStdDevAfter = kStdDevBefore;
      if (decision === "suppressed") {
        kStdDevAfter = Math.min(kStdDevBefore + ANOMALY_CONFIG.suppressionStepStdDev, ANOMALY_CONFIG.maxKStdDev);
        detail.kStdDevAfter = kStdDevAfter;
        await client.query(
          `INSERT INTO anomaly_thresholds (metric, k_std_dev) VALUES ($1, $2)
           ON CONFLICT (metric) DO UPDATE SET k_std_dev = $2, updated_at = now()`,
          [metric, kStdDevAfter],
        );
      }

      await client.query(
        `INSERT INTO anomaly_audit (metric, month, step, actor, detail) VALUES ($1, $2, $3, $4, $5)`,
        [metric, month, decision, req.user!.id, JSON.stringify(detail)],
      );

      await client.query("COMMIT");

      // Recompute against the post-decision threshold so the response
      // immediately shows "no longer flagged" for a suppression, without a
      // second GET round-trip.
      const finalClassification = classifyAnomalies(series, kStdDevAfter);
      const finalPoint =
        finalClassification.status === "ok" ? finalClassification.points.find((p) => p.month === month) : undefined;

      logger.info(
        { correlationId: req.correlationId, metric, month, decision, kStdDevBefore, kStdDevAfter },
        "anomaly decision recorded",
      );
      res.status(200).json({
        point: finalPoint ? { ...finalPoint, decision } : null,
        threshold: { kStdDev: kStdDevAfter },
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection may already be unusable — the outer error is what matters.
      }
      logger.error({ correlationId: req.correlationId, err }, "anomaly decision failed");
      res.status(500).json({ error: "anomaly decision failed" });
    } finally {
      client.release();
    }
  });

  return router;
}
