import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeTargetingOpportunityRow {
  id: string;
  source: string;
  company: string;
  title: string;
  hard_to_fill_score: string;
  hard_to_fill_reasons: string[];
}

export interface FakeTargetingCandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
}

/**
 * In-memory stand-in for the two tables hardToFillTargetingRouter reads
 * (opportunities filtered to hard-to-fill, and candidates), served from one
 * query dispatcher — the same single-Pool shape a real Postgres presents.
 * Exposes `queryFn` so a test can assert the router only ever SELECTs (the
 * read-only / no-submit trust scenario).
 */
export function createFakeTargetingPool() {
  const opportunities: FakeTargetingOpportunityRow[] = [];
  const candidates: FakeTargetingCandidateRow[] = [];
  let nextOppId = 1;
  let nextCandidateId = 1;

  function seedOpportunity(
    overrides: Partial<FakeTargetingOpportunityRow> & { title: string; hard_to_fill_score: string },
  ): FakeTargetingOpportunityRow {
    const row: FakeTargetingOpportunityRow = {
      id: String(nextOppId++),
      source: "mock-job-board",
      company: "Unnamed Co",
      hard_to_fill_reasons: [],
      ...overrides,
    };
    opportunities.push(row);
    return row;
  }

  function seedCandidate(
    overrides: Partial<FakeTargetingCandidateRow> & { skills: string[] },
  ): FakeTargetingCandidateRow {
    const row: FakeTargetingCandidateRow = {
      id: String(nextCandidateId++),
      name: "Unnamed Student",
      experience: null,
      availability: null,
      ...overrides,
    };
    candidates.push(row);
    return row;
  }

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM opportunities") && sql.includes("hard_to_fill_score >=")) {
      const [threshold] = params as [number];
      // Mirrors the router's two literal SQL strings (S-18, 06_decisions/028):
      // only the default one excludes source='seed-job-board'. Matching on
      // the SQL text itself (not a separate flag) keeps this fake honest
      // about which branch actually ran.
      const excludesSeedData = sql.includes("source != 'seed-job-board'");
      return {
        rows: opportunities.filter(
          (o) =>
            (!excludesSeedData || o.source !== "seed-job-board") &&
            Number(o.hard_to_fill_score) >= threshold,
        ),
      };
    }
    if (sql.includes("FROM candidates")) {
      return { rows: [...candidates] };
    }
    throw new Error(`fakeTargetingPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    queryFn: query,
    opportunities,
    candidates,
    seedOpportunity,
    seedCandidate,
  };
}
