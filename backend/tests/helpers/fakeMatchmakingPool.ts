import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeMatchJobOpeningRow {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  requirements: string[];
  created_at: string;
  updated_at: string;
}

export interface FakeMatchCandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
  contact_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Combined in-memory stand-in for job_openings + candidates, read-only.
 * clientMatchmakingRouter SELECTs from both tables through one Pool — a real
 * Postgres connection makes no distinction between them — so unlike
 * fakeJobOpeningsPool/fakeCandidatesPool (each scoped to one table's CRUD),
 * this fake serves both from a single query dispatcher.
 */
export function createFakeMatchmakingPool() {
  const jobOpenings: FakeMatchJobOpeningRow[] = [];
  const candidates: FakeMatchCandidateRow[] = [];
  let nextJobId = 1;
  let nextCandidateId = 1;

  function seedJobOpening(
    overrides: Partial<FakeMatchJobOpeningRow> & { requirements: string[] },
  ): FakeMatchJobOpeningRow {
    const now = new Date().toISOString();
    const row: FakeMatchJobOpeningRow = {
      id: String(nextJobId++),
      client_id: "client-1",
      title: "Untitled role",
      description: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };
    jobOpenings.push(row);
    return row;
  }

  function seedCandidate(
    overrides: Partial<FakeMatchCandidateRow> & { skills: string[] },
  ): FakeMatchCandidateRow {
    const now = new Date().toISOString();
    const row: FakeMatchCandidateRow = {
      id: String(nextCandidateId++),
      name: "Unnamed Candidate",
      experience: null,
      availability: null,
      contact_info: {},
      created_at: now,
      updated_at: now,
      ...overrides,
    };
    candidates.push(row);
    return row;
  }

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM job_openings WHERE id")) {
      const [id] = params as [string];
      const match = jobOpenings.find((row) => row.id === id);
      return { rows: match ? [match] : [] };
    }
    if (sql.includes("FROM candidates")) {
      return { rows: [...candidates] };
    }
    throw new Error(`fakeMatchmakingPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    jobOpenings,
    candidates,
    seedJobOpening,
    seedCandidate,
  };
}
