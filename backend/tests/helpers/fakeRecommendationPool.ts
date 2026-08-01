import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeJobOpeningRow {
  id: string;
  requirements: string[];
}

export interface FakeCandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
}

export interface FakeFeedbackRow {
  id: string;
  job_id: string;
  candidate_id: string;
  recruiter_id: string;
  feedback: "good" | "bad";
  created_at: string;
  updated_at: string;
}

/**
 * In-memory stand-in for job_openings + candidates (read-only lookups here)
 * plus recommendation_feedback (the table this router actually writes to).
 * Simulates the FK violation on an unknown candidateId (Postgres code
 * 23503) the same way fakeSalesPipelinePool does for an unknown clientId,
 * so recommendationEngine.ts's isForeignKeyViolation catch path is
 * genuinely exercised, not just assumed.
 */
export function createFakeRecommendationPool() {
  const jobOpenings: FakeJobOpeningRow[] = [];
  const candidates: FakeCandidateRow[] = [];
  const feedback: FakeFeedbackRow[] = [];
  let nextJobId = 1;
  let nextCandidateId = 1;
  let nextFeedbackId = 1;

  function seedJobOpening(
    overrides: Partial<FakeJobOpeningRow> & { requirements: string[] },
  ): FakeJobOpeningRow {
    const row: FakeJobOpeningRow = { id: `job-${nextJobId++}`, ...overrides };
    jobOpenings.push(row);
    return row;
  }

  function seedCandidate(
    overrides: Partial<FakeCandidateRow> & { skills: string[] },
  ): FakeCandidateRow {
    const row: FakeCandidateRow = {
      id: `candidate-${nextCandidateId++}`,
      name: "Unnamed Candidate",
      experience: null,
      availability: null,
      ...overrides,
    };
    candidates.push(row);
    return row;
  }

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM job_openings WHERE id")) {
      const [id] = params as [string];
      const row = jobOpenings.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith("SELECT id, name, skills, experience, availability FROM candidates")) {
      return { rows: [...candidates] };
    }

    if (sql.includes("FROM recommendation_feedback WHERE job_id")) {
      const [jobId, recruiterId] = params as [string, string];
      return {
        rows: feedback
          .filter((f) => f.job_id === jobId && f.recruiter_id === recruiterId)
          .map((f) => ({ candidate_id: f.candidate_id, feedback: f.feedback })),
      };
    }

    if (sql.includes("INSERT INTO recommendation_feedback")) {
      const [jobId, candidateId, recruiterId, feedbackValue] = params as [
        string,
        string,
        string,
        "good" | "bad",
      ];
      if (!candidates.some((c) => c.id === candidateId)) {
        throw { code: "23503", message: "insert or update on table \"recommendation_feedback\" violates foreign key constraint" };
      }
      const now = new Date().toISOString();
      const existing = feedback.find(
        (f) => f.job_id === jobId && f.candidate_id === candidateId && f.recruiter_id === recruiterId,
      );
      if (existing) {
        existing.feedback = feedbackValue;
        existing.updated_at = now;
        return { rows: [existing] };
      }
      const row: FakeFeedbackRow = {
        id: `feedback-${nextFeedbackId++}`,
        job_id: jobId,
        candidate_id: candidateId,
        recruiter_id: recruiterId,
        feedback: feedbackValue,
        created_at: now,
        updated_at: now,
      };
      feedback.push(row);
      return { rows: [row] };
    }

    throw new Error(`fakeRecommendationPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    jobOpenings,
    candidates,
    feedback,
    seedJobOpening,
    seedCandidate,
  };
}
