import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import type { PipelineNotifier } from "../adapters/pipelineNotifier";

const STAGES = ["prospecting", "contacted", "negotiation", "closed"] as const;
type Stage = (typeof STAGES)[number];

interface SalesPipelineRow {
  id: string;
  client_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface SalesPipelineWithClientRow extends SalesPipelineRow {
  client_name: string;
}

function toPipelineResponse(row: SalesPipelineRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPipelineWithClientResponse(row: SalesPipelineWithClientRow) {
  return { ...toPipelineResponse(row), clientName: row.client_name };
}

function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

// Same 23503 check as jobOpenings.ts's isForeignKeyViolation.
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23503"
  );
}

export function salesPipelineRouter(pool: Pool, notifier: PipelineNotifier): Router {
  const router = Router();

  // The first route in this codebase needing a real multi-statement
  // transaction: the pipeline row and its audit row must commit or roll back
  // together. pool.connect() checks out ONE client for the whole sequence —
  // pool.query() per call can silently hand different calls to different
  // pooled connections, which would break the transaction.
  // S-08: "As a sales rep..." — 06_decisions/022.
  router.post("/sales-pipeline/update", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    const clientId = req.body?.clientId;
    const toStage = req.body?.toStage;

    if (!isValidClientId(clientId)) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }
    if (!isValidStage(toStage)) {
      res.status(400).json({ error: `toStage must be one of ${STAGES.join(", ")}` });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Advisory lock, not a row lock: serializes concurrent update() calls
      // for this client_id even when no sales_pipeline row exists yet to
      // lock (SELECT ... FOR UPDATE can't lock a row that doesn't exist,
      // which is exactly the race that would otherwise let two concurrent
      // enrollments of the same new client both write an inaccurate
      // from_stage: null audit row — see 06_decisions/013). Auto-releases at
      // COMMIT/ROLLBACK.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [clientId]);

      const { rows: existingRows } = await client.query(
        "SELECT * FROM sales_pipeline WHERE client_id = $1",
        [clientId],
      );
      const existing = existingRows[0] as SalesPipelineRow | undefined;
      const priorStatus: Stage | null = (existing?.status as Stage | undefined) ?? null;

      if (priorStatus === toStage) {
        // No real transition — a safe no-op, not a spurious audit row (the
        // idempotency requirement: retrying an identical request is safe).
        await client.query("COMMIT");
        res.status(200).json({ pipeline: toPipelineResponse(existing!), changed: false });
        return;
      }

      const { rows: pipelineRows } = await client.query(
        `INSERT INTO sales_pipeline (client_id, status) VALUES ($1, $2)
         ON CONFLICT (client_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
         RETURNING *`,
        [clientId, toStage],
      );
      await client.query(
        `INSERT INTO sales_pipeline_audit (client_id, changed_by, from_stage, to_stage)
         VALUES ($1, $2, $3, $4)`,
        [clientId, req.user!.id, priorStatus, toStage],
      );
      await client.query("COMMIT");

      logger.info(
        { correlationId: req.correlationId, clientId, fromStage: priorStatus, toStage },
        "sales pipeline stage changed",
      );
      await notifier.notifyStageChanged({
        clientId,
        fromStage: priorStatus,
        toStage,
        changedBy: req.user!.id,
      });

      res.status(200).json({
        pipeline: toPipelineResponse(pipelineRows[0] as SalesPipelineRow),
        changed: true,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection may already be unusable — the outer error is what matters.
      }
      if (isForeignKeyViolation(err)) {
        res.status(400).json({ error: "client not found" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "sales pipeline update failed");
      res.status(500).json({ error: "update failed" });
    } finally {
      client.release();
    }
  });

  router.get("/sales-pipeline", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT sp.*, c.name AS client_name
         FROM sales_pipeline sp JOIN clients c ON c.id = sp.client_id
         ORDER BY sp.updated_at DESC`,
      );
      res.status(200).json({
        pipeline: (rows as SalesPipelineWithClientRow[]).map(toPipelineWithClientResponse),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list sales pipeline failed");
      res.status(500).json({ error: "failed to list sales pipeline" });
    }
  });

  return router;
}
