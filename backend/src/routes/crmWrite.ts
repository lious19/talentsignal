import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

// Client-record writes sit in the same persona lane as salesPipeline.ts
// ("As a sales rep...", S-08) plus admin oversight (06_decisions/024) —
// recruiter's domain in the existing permission matrix (decision 022) is
// candidates/packages/recommendations, not client/CRM records.
const CRM_ROLES = ["admin", "sales"];

type WriteImage = { name: string; contact_info: Record<string, unknown> } | null;

interface CrmWriteRow {
  id: string;
  idempotency_key: string;
  client_id: string;
  before_image: WriteImage;
  after_image: WriteImage;
  status: "applied" | "rolled_back";
  requested_by: string;
  created_at: string;
  updated_at: string;
}

interface ClientRow {
  id: string;
  name: string;
  contact_info: Record<string, unknown>;
  updated_at: string;
}

function toImageResponse(image: WriteImage) {
  return image ? { name: image.name, contactInfo: image.contact_info } : null;
}

function toCrmWriteResponse(row: CrmWriteRow) {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    clientId: row.client_id,
    beforeImage: toImageResponse(row.before_image),
    afterImage: toImageResponse(row.after_image),
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Narrow, deliberate exception to the usual PII_VISIBLE_ROLES gating in
// clients.ts: only admin/sales (CRM_ROLES) can ever reach this response,
// and the whole point of a guarded write / rollback is confirming exactly
// what was written or restored — withholding contactInfo here would defeat
// the feature for the only roles allowed to call it.
function toClientSnapshot(row: ClientRow) {
  return {
    id: row.id,
    name: row.name,
    contactInfo: row.contact_info,
    updatedAt: row.updated_at,
  };
}

function isValidKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidContactInfo(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same 23503 check as salesPipeline.ts's/jobOpenings.ts's isForeignKeyViolation.
// crm_writes.client_id REFERENCES clients(id), so claiming a key for an
// unknown client fails right there on the INSERT — before the later
// SELECT-based "client not found" branch below ever gets a chance to run.
// That branch is kept as defensive-only for the (vanishingly narrow) case
// of a client deleted between the claim and the SELECT; this catch is what
// actually handles the real, common case a bad clientId hits.
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23503"
  );
}

async function recordAudit(
  client: PoolClient,
  writeId: string,
  step: "applied" | "deduped" | "rolled_back",
  actor: string,
  detail: Record<string, unknown> | null,
): Promise<void> {
  await client.query(
    `INSERT INTO crm_write_audit (write_id, step, actor, detail) VALUES ($1, $2, $3, $4)`,
    [writeId, step, actor, detail ? JSON.stringify(detail) : null],
  );
}

export function crmWriteRouter(pool: Pool): Router {
  const router = Router();

  // The whole story in one handler: claim the idempotency key atomically
  // (auth.ts's ON CONFLICT pattern, used proactively instead of reactively
  // catching 23505), then — only on a genuinely new key — capture a
  // before-image, apply the write, capture the after-image, and audit it.
  // One transaction throughout, same pool.connect()/BEGIN/COMMIT shape as
  // opportunityPackage.ts's release handler.
  router.post("/crm/write", requireAuth, requireRole(CRM_ROLES), async (req, res) => {
    const idempotencyKey = req.body?.idempotencyKey;
    const clientId = req.body?.clientId;
    const name = req.body?.name;
    const contactInfo = req.body?.contactInfo ?? {};

    if (!isValidKey(idempotencyKey)) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    if (!isValidKey(clientId)) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }
    if (!isValidName(name)) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!isValidContactInfo(contactInfo)) {
      res.status(400).json({ error: "contactInfo must be an object" });
      return;
    }

    const requestedBy = req.user!.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const claim = await client.query<CrmWriteRow>(
        `INSERT INTO crm_writes (idempotency_key, client_id, requested_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [idempotencyKey, clientId, requestedBy],
      );

      if (claim.rows.length === 0) {
        // Key already processed — return the STORED result, current status
        // and all, without touching clients at all. Still recorded: dedupe
        // activity should be visible, not silent.
        const { rows: existingRows } = await client.query<CrmWriteRow>(
          "SELECT * FROM crm_writes WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        const existing = existingRows[0];
        await recordAudit(client, existing.id, "deduped", requestedBy, { idempotencyKey });
        await client.query("COMMIT");

        logger.info(
          { correlationId: req.correlationId, writeId: existing.id, idempotencyKey },
          "crm write deduped",
        );
        res.status(200).json({ write: toCrmWriteResponse(existing), deduped: true });
        return;
      }

      const writeId = claim.rows[0].id;

      const clientResult = await client.query<ClientRow>(
        "SELECT id, name, contact_info, updated_at FROM clients WHERE id = $1",
        [clientId],
      );
      if (clientResult.rows.length === 0) {
        // Rolling back un-claims the key too (the INSERT above is part of
        // this same transaction) — a corrected retry with the same key can
        // still succeed.
        await client.query("ROLLBACK");
        res.status(404).json({ error: "client not found" });
        return;
      }

      const beforeImage = {
        name: clientResult.rows[0].name,
        contact_info: clientResult.rows[0].contact_info,
      };

      const { rows: updatedRows } = await client.query<ClientRow>(
        `UPDATE clients SET name = $1, contact_info = $2, updated_at = now()
         WHERE id = $3 RETURNING id, name, contact_info, updated_at`,
        [name.trim(), contactInfo, clientId],
      );
      const afterImage = { name: updatedRows[0].name, contact_info: updatedRows[0].contact_info };

      const { rows: finalRows } = await client.query<CrmWriteRow>(
        `UPDATE crm_writes SET before_image = $1, after_image = $2, updated_at = now()
         WHERE id = $3 RETURNING *`,
        [beforeImage, afterImage, writeId],
      );
      await recordAudit(client, writeId, "applied", requestedBy, { clientId });

      await client.query("COMMIT");

      logger.info(
        { correlationId: req.correlationId, writeId, clientId, idempotencyKey },
        "crm write applied",
      );
      res.status(201).json({ write: toCrmWriteResponse(finalRows[0]), deduped: false });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection may already be unusable — the outer error is what matters.
      }
      if (isForeignKeyViolation(err)) {
        res.status(404).json({ error: "client not found" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "crm write failed");
      res.status(500).json({ error: "crm write failed" });
    } finally {
      client.release();
    }
  });

  // Reuses opportunityPackage.ts's exact race guard: a conditional UPDATE
  // whose WHERE clause is the only lock needed. Only one concurrent
  // rollback attempt on the same write can ever match "status = 'applied'".
  router.post(
    "/crm/write/:id/rollback",
    requireAuth,
    requireRole(CRM_ROLES),
    async (req, res) => {
      const writeId = req.params.id;
      const requestedBy = req.user!.id;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const guarded = await client.query<CrmWriteRow>(
          `UPDATE crm_writes SET status = 'rolled_back', updated_at = now()
           WHERE id = $1 AND status = 'applied' RETURNING *`,
          [writeId],
        );

        if (guarded.rows.length === 0) {
          const { rows: existingRows } = await client.query<CrmWriteRow>(
            "SELECT * FROM crm_writes WHERE id = $1",
            [writeId],
          );
          await client.query("ROLLBACK");

          if (existingRows.length === 0) {
            res.status(404).json({ error: "crm write not found" });
            return;
          }
          // Already rolled back — same "always return the authoritative
          // resource" discipline opportunityPackage.ts uses for its own
          // already-released 409 case.
          res.status(409).json({
            error: "crm write already rolled back",
            write: toCrmWriteResponse(existingRows[0]),
          });
          return;
        }

        const write = guarded.rows[0];
        const beforeImage = write.before_image!;

        const { rows: clientRows } = await client.query<ClientRow>(
          `UPDATE clients SET name = $1, contact_info = $2, updated_at = now()
           WHERE id = $3 RETURNING id, name, contact_info, updated_at`,
          [beforeImage.name, beforeImage.contact_info, write.client_id],
        );

        await recordAudit(client, write.id, "rolled_back", requestedBy, {
          restoredTo: beforeImage,
        });

        await client.query("COMMIT");

        logger.info(
          { correlationId: req.correlationId, writeId: write.id, clientId: write.client_id },
          "crm write rolled back",
        );
        res.status(200).json({
          write: toCrmWriteResponse(write),
          client: toClientSnapshot(clientRows[0]),
        });
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Connection may already be unusable — the outer error is what matters.
        }
        logger.error({ correlationId: req.correlationId, err }, "crm write rollback failed");
        res.status(500).json({ error: "crm write rollback failed" });
      } finally {
        client.release();
      }
    },
  );

  router.get("/crm/writes", requireAuth, requireRole(CRM_ROLES), async (req, res) => {
    try {
      const { rows } = await pool.query<CrmWriteRow>(
        "SELECT * FROM crm_writes ORDER BY created_at DESC",
      );
      res.status(200).json({ writes: rows.map(toCrmWriteResponse) });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list crm writes failed");
      res.status(500).json({ error: "failed to list crm writes" });
    }
  });

  return router;
}
