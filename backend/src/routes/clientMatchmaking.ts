import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { scoreCandidate, type MatchJobInput } from "../matching/matchScore";

interface JobOpeningRow {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  requirements: string[];
  created_at: string;
  updated_at: string;
}

interface CandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
  contact_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function isValidJobId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Deliberately narrower than candidates.ts's toCandidateResponse, which
// shows contact_info to admin/recruiter roles: this endpoint's job is
// ranking, not contact lookup, so contact_info is never read here, for any
// role. A recruiter who wants to reach out looks the candidate up
// separately via GET /candidates/:id — that keeps this suggestion-only
// endpoint's read surface as narrow as its actual job requires.
function toRankedCandidate(row: CandidateRow, job: MatchJobInput) {
  const result = scoreCandidate({ skills: row.skills, experience: row.experience }, job);
  return {
    id: row.id,
    name: row.name,
    experience: row.experience,
    availability: row.availability,
    ...result,
  };
}

// Tiebreak by candidate id (stable string comparison) so equal fit scores
// don't reorder nondeterministically between calls — same reasoning as
// hiddenDemand.ts's byRankThenId, and what the idempotency AC depends on.
function byFitScoreThenId(
  a: ReturnType<typeof toRankedCandidate>,
  b: ReturnType<typeof toRankedCandidate>,
): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function clientMatchmakingRouter(pool: Pool): Router {
  const router = Router();

  // Read-only suggestion endpoint (REQ-002/REQ-020): computes and returns a
  // ranking, never writes to job_openings or candidates, and never contacts
  // any client system. There is no "submit to client" endpoint anywhere in
  // this codebase yet — that is S-09's human-release gate. `suggestion: true`
  // in the response is part of that trust contract, not decoration.
  // S-06: "As a sales rep..." — 06_decisions/022.
  router.post("/client-matchmaking/match", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    const jobId = req.body?.jobId;
    if (!isValidJobId(jobId)) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }

    try {
      const jobResult = await pool.query("SELECT * FROM job_openings WHERE id = $1", [jobId]);
      if (jobResult.rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }
      const jobRow = jobResult.rows[0] as JobOpeningRow;
      const job: MatchJobInput = { requirements: jobRow.requirements };

      const candidatesResult = await pool.query("SELECT * FROM candidates");
      const candidates = (candidatesResult.rows as CandidateRow[])
        .map((row) => toRankedCandidate(row, job))
        .sort(byFitScoreThenId);

      logger.info(
        { correlationId: req.correlationId, jobId, count: candidates.length },
        "client matchmaking match completed",
      );
      res.status(200).json({ suggestion: true, jobId, candidates });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "client matchmaking match failed");
      res.status(500).json({ error: "match failed" });
    }
  });

  return router;
}
