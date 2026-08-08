import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

// Matches pii_fields.redact_from_display for candidates.contact_info
// (06_decisions/009). candidates.name is PII too (S-15 must be able to
// anonymize it on an erasure request) but redact_from_display is false for
// it — it stays visible to every authenticated role because S-06's
// matchmaking read path needs it. That's the whole point of splitting "is
// PII" from "hidden from display" instead of using one flag for both.
const PII_VISIBLE_ROLES = ["admin", "recruiter"];

interface CandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
  contact_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  consent_given: boolean;
  consent_recorded_at: string | null;
}

// Consent gates whether contactInfo appears in these ordinary staff-facing
// responses (06_decisions/023) — it does NOT gate the S-15 privacy-request
// workflow itself, which reads raw columns through piiRegistry.ts, not this
// function. A person's own access/erasure rights are unconditional; only
// routine staff viewing (for outreach) needs consent. DEFAULT true on the
// column is a documented pragmatic exception, not the GDPR-faithful
// posture — see 06_decisions/023 for why, and consentGiven/consentRecordedAt
// below so the React screen can show and flip the flag.
function toCandidateResponse(row: CandidateRow, role: string) {
  const base = {
    id: row.id,
    name: row.name,
    skills: row.skills,
    experience: row.experience,
    availability: row.availability,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    consentGiven: row.consent_given,
    consentRecordedAt: row.consent_recorded_at,
  };
  return PII_VISIBLE_ROLES.includes(role) && row.consent_given
    ? { ...base, contactInfo: row.contact_info }
    : base;
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidSkills(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((skill) => typeof skill === "string");
}

function isValidExperience(value: unknown): value is number | null {
  return value === null || value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isValidAvailability(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === "string";
}

function isValidContactInfo(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidConsent(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

export function candidatesRouter(pool: Pool): Router {
  const router = Router();

  router.post("/candidates", requireAuth, requireRole(PII_VISIBLE_ROLES), async (req, res) => {
    const name = req.body?.name;
    const skills = req.body?.skills ?? [];
    const experience = req.body?.experience ?? null;
    const availability = req.body?.availability ?? null;
    const contactInfo = req.body?.contactInfo ?? {};

    if (!isValidName(name)) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!isValidSkills(skills)) {
      res.status(400).json({ error: "skills must be an array of strings" });
      return;
    }
    if (!isValidExperience(experience)) {
      res.status(400).json({ error: "experience must be a non-negative integer" });
      return;
    }
    if (!isValidAvailability(availability)) {
      res.status(400).json({ error: "availability must be a string" });
      return;
    }
    if (!isValidContactInfo(contactInfo)) {
      res.status(400).json({ error: "contactInfo must be an object" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO candidates (name, skills, experience, availability, contact_info)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name.trim(), skills, experience, availability, contactInfo],
      );
      logger.info(
        { correlationId: req.correlationId, candidateId: rows[0].id },
        "candidate created",
      );
      res.status(201).json(toCandidateResponse(rows[0] as CandidateRow, req.user!.role));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "candidate create failed");
      res.status(500).json({ error: "failed to create candidate" });
    }
  });

  router.get("/candidates", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM candidates ORDER BY created_at DESC");
      res.status(200).json({
        candidates: (rows as CandidateRow[]).map((row) => toCandidateResponse(row, req.user!.role)),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list candidates failed");
      res.status(500).json({ error: "failed to list candidates" });
    }
  });

  router.get("/candidates/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM candidates WHERE id = $1", [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: "candidate not found" });
        return;
      }
      res.status(200).json(toCandidateResponse(rows[0] as CandidateRow, req.user!.role));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "get candidate failed");
      res.status(500).json({ error: "failed to get candidate" });
    }
  });

  router.put("/candidates/:id", requireAuth, requireRole(PII_VISIBLE_ROLES), async (req, res) => {
    const name = req.body?.name;
    const skills = req.body?.skills ?? [];
    const experience = req.body?.experience ?? null;
    const availability = req.body?.availability ?? null;
    const contactInfo = req.body?.contactInfo ?? {};
    const consent = req.body?.consent;

    if (!isValidName(name)) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!isValidSkills(skills)) {
      res.status(400).json({ error: "skills must be an array of strings" });
      return;
    }
    if (!isValidExperience(experience)) {
      res.status(400).json({ error: "experience must be a non-negative integer" });
      return;
    }
    if (!isValidAvailability(availability)) {
      res.status(400).json({ error: "availability must be a string" });
      return;
    }
    if (!isValidContactInfo(contactInfo)) {
      res.status(400).json({ error: "contactInfo must be an object" });
      return;
    }
    if (!isValidConsent(consent)) {
      res.status(400).json({ error: "consent must be a boolean" });
      return;
    }

    try {
      // consent omitted from the body ($6 is null) leaves consent_given and
      // consent_recorded_at untouched — this is the "revoke" trust scenario:
      // PUT with { consent: false } flips it and stamps the timestamp; any
      // other PUT call that doesn't mention consent at all (every existing
      // caller) can't accidentally reset it back to true.
      const { rows } = await pool.query(
        `UPDATE candidates
         SET name = $1, skills = $2, experience = $3, availability = $4,
             contact_info = $5,
             consent_given = COALESCE($6::boolean, consent_given),
             consent_recorded_at = CASE WHEN $6::boolean IS NULL THEN consent_recorded_at ELSE now() END,
             updated_at = now()
         WHERE id = $7 RETURNING *`,
        [name.trim(), skills, experience, availability, contactInfo, consent ?? null, req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "candidate not found" });
        return;
      }
      res.status(200).json(toCandidateResponse(rows[0] as CandidateRow, req.user!.role));
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "update candidate failed");
      res.status(500).json({ error: "failed to update candidate" });
    }
  });

  router.delete(
    "/candidates/:id",
    requireAuth,
    requireRole(PII_VISIBLE_ROLES),
    async (req, res) => {
      try {
        const { rows } = await pool.query(
          "DELETE FROM candidates WHERE id = $1 RETURNING id",
          [req.params.id],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: "candidate not found" });
          return;
        }
        res.status(204).send();
      } catch (err) {
        logger.error({ correlationId: req.correlationId, err }, "delete candidate failed");
        res.status(500).json({ error: "failed to delete candidate" });
      }
    },
  );

  return router;
}
