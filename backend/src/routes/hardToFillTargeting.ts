import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { scoreCandidate } from "../matching/matchScore";
import { requirementsForTitle } from "../matching/roleSkillsConfig";
import { HARD_TO_FILL_CONFIG } from "../scoring/hardToFillConfig";

interface HardToFillOpportunityRow {
  id: string;
  company: string;
  title: string;
  hard_to_fill_score: string;
  hard_to_fill_reasons: string[];
}

interface CandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
}

// Reuses scoreCandidate() unchanged (S-11) — the SAME ranking algorithm
// clientMatchmaking.ts and recommendationEngine.ts use, not a new one. The
// only HF-3-specific glue is deriving the role's requirements from the
// opportunity's title (roleSkillsConfig, 06_decisions/027). contact_info is
// never read here — ranking surfaces name, not contact details, the same
// discipline clientMatchmaking.ts follows.
function toRankedStudent(row: CandidateRow, requirements: string[]) {
  const result = scoreCandidate({ skills: row.skills, experience: row.experience }, { requirements });
  return {
    id: row.id,
    name: row.name,
    experience: row.experience,
    availability: row.availability,
    ...result,
  };
}

// Same tiebreak convention as clientMatchmaking.ts's byFitScoreThenId — a
// stable id tiebreak so equal scores don't reorder between calls (the
// idempotency AC).
function byFitScoreThenId(
  a: ReturnType<typeof toRankedStudent>,
  b: ReturnType<typeof toRankedStudent>,
): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function hardToFillTargetingRouter(pool: Pool): Router {
  const router = Router();

  // Read-only and ADVISORY (REQ-020 / the "AI drafts, a human releases"
  // rule): returns a suggested pairing of each hard-to-fill opportunity with
  // the students best matched to it. It never writes, never contacts a client
  // system, and there is NO submit path anywhere in this router — `suggestion:
  // true` is part of that trust contract, exactly like clientMatchmaking.ts.
  // A human reads this and decides who to submit; nothing here submits anyone.
  // Only opportunities at or above HARD_TO_FILL_CONFIG.hardToFillThreshold are
  // included, so the targeting board never lists a role HF-1/HF-2 didn't flag.
  // S-06 / 06_decisions/022: admin + sales.
  router.get(
    "/hard-to-fill/targeting",
    requireAuth,
    requireRole(["admin", "sales"]),
    async (req, res) => {
      try {
        const [oppResult, candidatesResult] = await Promise.all([
          pool.query(
            `SELECT id, company, title, hard_to_fill_score, hard_to_fill_reasons
             FROM opportunities
             WHERE hard_to_fill_score >= $1 AND source != 'seed-job-board'`,
            [HARD_TO_FILL_CONFIG.hardToFillThreshold],
          ),
          pool.query("SELECT id, name, skills, experience, availability FROM candidates"),
        ]);

        const candidates = candidatesResult.rows as CandidateRow[];

        const targets = (oppResult.rows as HardToFillOpportunityRow[])
          .map((opp) => {
            const { roleType, requirements } = requirementsForTitle(opp.title);
            const students = candidates
              .map((candidate) => toRankedStudent(candidate, requirements))
              .sort(byFitScoreThenId);
            return {
              opportunityId: opp.id,
              company: opp.company,
              title: opp.title,
              roleType,
              requirements,
              hardToFillScore: Number(opp.hard_to_fill_score),
              hardToFillReasons: opp.hard_to_fill_reasons,
              students,
            };
          })
          // Hardest-to-fill first; opportunityId is the stable tiebreak so
          // equal scores don't reorder between calls.
          .sort((a, b) =>
            b.hardToFillScore !== a.hardToFillScore
              ? b.hardToFillScore - a.hardToFillScore
              : a.opportunityId < b.opportunityId
                ? -1
                : a.opportunityId > b.opportunityId
                  ? 1
                  : 0,
          );

        logger.info(
          { correlationId: req.correlationId, targets: targets.length },
          "hard-to-fill targeting completed",
        );
        res.status(200).json({ suggestion: true, targets });
      } catch (err) {
        logger.error({ correlationId: req.correlationId, err }, "hard-to-fill targeting failed");
        res.status(500).json({ error: "targeting failed" });
      }
    },
  );

  return router;
}
