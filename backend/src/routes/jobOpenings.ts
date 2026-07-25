import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";

interface JobOpeningRow {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  requirements: string[];
  created_at: string;
  updated_at: string;
}

function toJobOpeningResponse(row: JobOpeningRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    description: row.description,
    requirements: row.requirements,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDescription(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === "string";
}

function isValidRequirements(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((requirement) => typeof requirement === "string");
}

// Postgres foreign-key-violation code — same shape as auth.ts's
// isUniqueViolation (23505), for the FK job_openings.client_id -> clients.id.
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23503"
  );
}

export function jobOpeningsRouter(pool: Pool): Router {
  const router = Router();

  // No PII here and no role gate: S-06 needs any authenticated role (sales
  // included) to read job openings, and Ali's build note doesn't restrict
  // who creates one.
  router.post("/job-openings", requireAuth, async (req, res) => {
    const clientId = req.body?.clientId;
    const title = req.body?.title;
    const description = req.body?.description ?? null;
    const requirements = req.body?.requirements ?? [];

    if (!isValidClientId(clientId)) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }
    if (!isValidTitle(title)) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!isValidDescription(description)) {
      res.status(400).json({ error: "description must be a string" });
      return;
    }
    if (!isValidRequirements(requirements)) {
      res.status(400).json({ error: "requirements must be an array of strings" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO job_openings (client_id, title, description, requirements)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [clientId, title.trim(), description, requirements],
      );
      logger.info(
        { correlationId: req.correlationId, jobOpeningId: rows[0].id },
        "job opening created",
      );
      res.status(201).json(toJobOpeningResponse(rows[0] as JobOpeningRow));
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        res.status(400).json({ error: "client not found" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "job opening create failed");
      res.status(500).json({ error: "failed to create job opening" });
    }
  });

  router.get("/job-openings", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM job_openings ORDER BY created_at DESC");
      res.status(200).json({ jobOpenings: (rows as JobOpeningRow[]).map(toJobOpeningResponse) });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list job openings failed");
      res.status(500).json({ error: "failed to list job openings" });
    }
  });

  router.get("/job-openings/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM job_openings WHERE id = $1", [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }
      res.status(200).json(toJobOpeningResponse(rows[0] as JobOpeningRow));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "get job opening failed");
      res.status(500).json({ error: "failed to get job opening" });
    }
  });

  router.put("/job-openings/:id", requireAuth, async (req, res) => {
    const clientId = req.body?.clientId;
    const title = req.body?.title;
    const description = req.body?.description ?? null;
    const requirements = req.body?.requirements ?? [];

    if (!isValidClientId(clientId)) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }
    if (!isValidTitle(title)) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!isValidDescription(description)) {
      res.status(400).json({ error: "description must be a string" });
      return;
    }
    if (!isValidRequirements(requirements)) {
      res.status(400).json({ error: "requirements must be an array of strings" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `UPDATE job_openings
         SET client_id = $1, title = $2, description = $3, requirements = $4, updated_at = now()
         WHERE id = $5 RETURNING *`,
        [clientId, title.trim(), description, requirements, req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }
      res.status(200).json(toJobOpeningResponse(rows[0] as JobOpeningRow));
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        res.status(400).json({ error: "client not found" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "update job opening failed");
      res.status(500).json({ error: "failed to update job opening" });
    }
  });

  router.delete("/job-openings/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "DELETE FROM job_openings WHERE id = $1 RETURNING id",
        [req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }
      res.status(204).send();
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "delete job opening failed");
      res.status(500).json({ error: "failed to delete job opening" });
    }
  });

  return router;
}
