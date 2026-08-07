import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { scoreCandidate, type MatchJobInput } from "../matching/matchScore";

interface JobOpeningRow {
  id: string;
  requirements: string[];
}

interface CandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
}

interface FeedbackRow {
  candidate_id: string;
  feedback: "good" | "bad";
}

type FeedbackStatus = "good" | "bad" | "none";

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidFeedback(value: unknown): value is "good" | "bad" {
  return value === "good" || value === "bad";
}

// Same 23503 check as salesPipeline.ts's isForeignKeyViolation.
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23503"
  );
}

// Deliberately the SAME response shape scoreCandidate() already produces —
// no new rationale is invented here, only `feedback` is added on top. Kept
// as this route's own local wrapper (not imported from clientMatchmaking.ts,
// which doesn't export it) — the same "each route keeps its own thin
// response-shaping glue" convention composePackage.ts already established;
// the shared, reused piece is scoreCandidate() itself, not this wrapper.
function toRecommendedCandidate(
  row: CandidateRow,
  job: MatchJobInput,
  feedbackByCandidateId: Map<string, "good" | "bad">,
) {
  const result = scoreCandidate({ skills: row.skills, experience: row.experience }, job);
  return {
    id: row.id,
    name: row.name,
    experience: row.experience,
    availability: row.availability,
    ...result,
    feedback: (feedbackByCandidateId.get(row.id) ?? "none") as FeedbackStatus,
  };
}

// Same tiebreak convention as clientMatchmaking.ts's byFitScoreThenId.
function byFitScoreThenId(
  a: ReturnType<typeof toRecommendedCandidate>,
  b: ReturnType<typeof toRecommendedCandidate>,
): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function recommendationEngineRouter(pool: Pool): Router {
  const router = Router();

  // Reuses scoreCandidate() unchanged — S-06's exact ranking algorithm, not
  // a second scorer. The only new work here is attaching this recruiter's
  // OWN feedback mark per candidate (not a cross-recruiter aggregate — see
  // 06_decisions/019) and shaping the response. Still an advisory
  // suggestion, never an auto-action — same `suggestion: true` labeling
  // convention as clientMatchmaking.ts.
  // S-11: "As a recruiter..." — the one unambiguous single-role case in
  // 06_decisions/022's matrix.
  router.post("/recommendation-engine/recommend", requireAuth, requireRole(["admin", "recruiter"]), async (req, res) => {
    const jobId = req.body?.jobId;
    if (!isValidId(jobId)) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }

    try {
      const jobResult = await pool.query(
        "SELECT id, requirements FROM job_openings WHERE id = $1",
        [jobId],
      );
      if (jobResult.rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }
      const jobRow = jobResult.rows[0] as JobOpeningRow;
      const job: MatchJobInput = { requirements: jobRow.requirements };

      const [candidatesResult, feedbackResult] = await Promise.all([
        pool.query("SELECT id, name, skills, experience, availability FROM candidates"),
        pool.query(
          "SELECT candidate_id, feedback FROM recommendation_feedback WHERE job_id = $1 AND recruiter_id = $2",
          [jobId, req.user!.id],
        ),
      ]);

      const feedbackByCandidateId = new Map<string, "good" | "bad">();
      for (const row of feedbackResult.rows as FeedbackRow[]) {
        feedbackByCandidateId.set(row.candidate_id, row.feedback);
      }

      const candidates = (candidatesResult.rows as CandidateRow[])
        .map((row) => toRecommendedCandidate(row, job, feedbackByCandidateId))
        .sort(byFitScoreThenId);

      logger.info(
        { correlationId: req.correlationId, jobId, count: candidates.length },
        "recommendation engine recommend completed",
      );
      res.status(200).json({ suggestion: true, jobId, candidates });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "recommendation engine recommend failed");
      res.status(500).json({ error: "recommend failed" });
    }
  });

  // The feedback loop — the genuinely new part of this story. Reversible
  // (good<->bad), one row per (job, candidate, recruiter), upserted. "Bank
  // the signal now, tune later": nothing here retrains or reads this table
  // to change a future ranking.
  router.post("/recommendation-engine/feedback", requireAuth, requireRole(["admin", "recruiter"]), async (req, res) => {
    const jobId = req.body?.jobId;
    const candidateId = req.body?.candidateId;
    const feedback = req.body?.feedback;

    if (!isValidId(jobId)) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }
    if (!isValidId(candidateId)) {
      res.status(400).json({ error: "candidateId is required" });
      return;
    }
    if (!isValidFeedback(feedback)) {
      res.status(400).json({ error: "feedback must be 'good' or 'bad'" });
      return;
    }

    try {
      const jobResult = await pool.query("SELECT id FROM job_openings WHERE id = $1", [jobId]);
      if (jobResult.rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO recommendation_feedback (job_id, candidate_id, recruiter_id, feedback)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (job_id, candidate_id, recruiter_id)
         DO UPDATE SET feedback = EXCLUDED.feedback, updated_at = now()
         RETURNING *`,
        [jobId, candidateId, req.user!.id, feedback],
      );
      const row = rows[0];

      logger.info(
        { correlationId: req.correlationId, jobId, candidateId, feedback },
        "recommendation feedback recorded",
      );
      res.status(200).json({
        feedback: {
          jobId: row.job_id,
          candidateId: row.candidate_id,
          recruiterId: row.recruiter_id,
          feedback: row.feedback,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        res.status(400).json({ error: "candidate not found" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "recommendation feedback failed");
      res.status(500).json({ error: "feedback failed" });
    }
  });

  // S-14 (06_decisions/022) — new route, added inside an RBAC story purely to
  // give the ownership trust scenario something real to test. Without a
  // route like this, recruiter_id's existing per-user scoping (see the
  // /recommend and /feedback handlers above) can never be reached by a
  // cross-user request, because feedback rows are always written under the
  // caller's own id — there was nothing to deny. Defaults to the caller's
  // own feedback; a non-admin explicitly asking for someone else's is
  // denied and logged the same way requireRole logs a role denial. Admin
  // may pass any recruiterId, or omit it to see every recruiter's feedback
  // for the job.
  router.get("/recommendation-engine/feedback", requireAuth, requireRole(["admin", "recruiter"]), async (req, res) => {
    const jobId = req.query.jobId;
    const requestedRecruiterId = req.query.recruiterId;

    if (!isValidId(jobId)) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }
    if (requestedRecruiterId !== undefined && !isValidId(requestedRecruiterId)) {
      res.status(400).json({ error: "recruiterId must be a non-empty string" });
      return;
    }

    const isAdmin = req.user!.role === "admin";
    if (requestedRecruiterId !== undefined && !isAdmin && requestedRecruiterId !== req.user!.id) {
      logger.warn(
        {
          correlationId: req.correlationId,
          userId: req.user!.id,
          role: req.user!.role,
          route: req.path,
          method: req.method,
          requestedRecruiterId,
        },
        "access denied — ownership",
      );
      res.status(403).json({ error: "cannot view another recruiter's feedback" });
      return;
    }

    // Own feedback by default; admin may omit recruiterId entirely to see
    // every recruiter's feedback for this job.
    const scopedRecruiterId = requestedRecruiterId ?? (isAdmin ? undefined : req.user!.id);

    try {
      const jobResult = await pool.query("SELECT id FROM job_openings WHERE id = $1", [jobId]);
      if (jobResult.rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }

      const { rows } = await (scopedRecruiterId === undefined
        ? pool.query(
            "SELECT * FROM recommendation_feedback WHERE job_id = $1 ORDER BY updated_at DESC",
            [jobId],
          )
        : pool.query(
            "SELECT * FROM recommendation_feedback WHERE job_id = $1 AND recruiter_id = $2 ORDER BY updated_at DESC",
            [jobId, scopedRecruiterId],
          ));

      logger.info(
        { correlationId: req.correlationId, jobId, scopedRecruiterId: scopedRecruiterId ?? "all", count: rows.length },
        "recommendation feedback listed",
      );
      res.status(200).json({
        feedback: rows.map((row) => ({
          jobId: row.job_id,
          candidateId: row.candidate_id,
          recruiterId: row.recruiter_id,
          feedback: row.feedback,
          updatedAt: row.updated_at,
        })),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "recommendation feedback list failed");
      res.status(500).json({ error: "failed to list feedback" });
    }
  });

  return router;
}
