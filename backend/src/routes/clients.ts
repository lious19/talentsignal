import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

// Who sees contact_info in a response. Matches pii_fields.redact_from_display
// for clients.contact_info (06_decisions/009) — kept as a plain constant here
// rather than a runtime query against pii_fields, since the registry's job is
// to make PII *findable* for S-15, not to be re-queried on every request.
const PII_VISIBLE_ROLES = ["admin", "recruiter"];

interface ClientRow {
  id: string;
  name: string;
  contact_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toClientResponse(row: ClientRow, role: string) {
  const base = {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return PII_VISIBLE_ROLES.includes(role) ? { ...base, contactInfo: row.contact_info } : base;
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidContactInfo(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clientsRouter(pool: Pool): Router {
  const router = Router();

  router.post("/clients", requireAuth, requireRole(PII_VISIBLE_ROLES), async (req, res) => {
    const name = req.body?.name;
    const contactInfo = req.body?.contactInfo ?? {};

    if (!isValidName(name)) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!isValidContactInfo(contactInfo)) {
      res.status(400).json({ error: "contactInfo must be an object" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING *`,
        [name.trim(), contactInfo],
      );
      logger.info({ correlationId: req.correlationId, clientId: rows[0].id }, "client created");
      res.status(201).json(toClientResponse(rows[0] as ClientRow, req.user!.role));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "client create failed");
      res.status(500).json({ error: "failed to create client" });
    }
  });

  router.get("/clients", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM clients ORDER BY created_at DESC");
      res.status(200).json({
        clients: (rows as ClientRow[]).map((row) => toClientResponse(row, req.user!.role)),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list clients failed");
      res.status(500).json({ error: "failed to list clients" });
    }
  });

  router.get("/clients/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM clients WHERE id = $1", [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "client not found" });
        return;
      }
      res.status(200).json(toClientResponse(rows[0] as ClientRow, req.user!.role));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "get client failed");
      res.status(500).json({ error: "failed to get client" });
    }
  });

  router.put("/clients/:id", requireAuth, requireRole(PII_VISIBLE_ROLES), async (req, res) => {
    const name = req.body?.name;
    const contactInfo = req.body?.contactInfo ?? {};

    if (!isValidName(name)) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!isValidContactInfo(contactInfo)) {
      res.status(400).json({ error: "contactInfo must be an object" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `UPDATE clients SET name = $1, contact_info = $2, updated_at = now()
         WHERE id = $3 RETURNING *`,
        [name.trim(), contactInfo, req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "client not found" });
        return;
      }
      res.status(200).json(toClientResponse(rows[0] as ClientRow, req.user!.role));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "update client failed");
      res.status(500).json({ error: "failed to update client" });
    }
  });

  router.delete("/clients/:id", requireAuth, requireRole(PII_VISIBLE_ROLES), async (req, res) => {
    try {
      const { rows } = await pool.query("DELETE FROM clients WHERE id = $1 RETURNING id", [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: "client not found" });
        return;
      }
      res.status(204).send();
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "delete client failed");
      res.status(500).json({ error: "failed to delete client" });
    }
  });

  return router;
}
