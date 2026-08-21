import type { Pool } from "pg";
import { createPool } from "./pool";
import { runMigrations } from "./migrate";
import { seedAnalyticsDemo } from "./seedAnalyticsDemo";
import { upsertBatch } from "../routes/hiddenDemand";
import { SeedJobBoardProvider } from "../adapters/seedJobBoardProvider";

/**
 * S-19's single demo-dataset entry point. Composes three already-reviewed
 * pieces instead of inventing a fourth: seedAnalyticsDemo() (clients +
 * pipeline history + job_openings, S-12/S-13/S-17), a small fixed candidate
 * roster (new here), and SeedJobBoardProvider run through the real
 * hiddenDemand upsertBatch() (S-04/S-18) so at least one seeded opportunity
 * genuinely clears the 0.5 hard-to-fill threshold — reusing the actual
 * scorer rather than hand-writing a second, guessable score. See
 * 06_decisions/029.
 *
 * Used identically by three callers: this file's own CLI (`npm run
 * seed:demo`, for `docker compose`'s live demo), seedDemo.idempotent.
 * integration.test.ts (proves the "identically every run" acceptance
 * criterion), and hiddenDemandJourney.e2e.test.ts's beforeAll (establishes a
 * baseline the journey's own live analyze() call adds on top of).
 */
const CANDIDATE_PREFIX = "Seed Demo Candidate";

interface SeedCandidate {
  name: string;
  skills: string[];
  experience: number;
}

// Skills drawn from roleSkillsConfig.ts's ROLE_SKILLS so at least one
// candidate has a real, matchable overlap against a hard-to-fill role's
// requirements in the live demo — not just against generic job openings.
const SEED_CANDIDATES: SeedCandidate[] = [
  { name: `${CANDIDATE_PREFIX} 01`, skills: ["sql", "python", "statistics", "excel"], experience: 4 },
  { name: `${CANDIDATE_PREFIX} 02`, skills: ["python", "machine learning", "pandas"], experience: 2 },
  { name: `${CANDIDATE_PREFIX} 03`, skills: ["react", "javascript", "css"], experience: 3 },
  { name: `${CANDIDATE_PREFIX} 04`, skills: ["java", "spring", "sql"], experience: 6 },
  { name: `${CANDIDATE_PREFIX} 05`, skills: ["aws", "terraform", "kubernetes"], experience: 5 },
  { name: `${CANDIDATE_PREFIX} 06`, skills: ["sql", "excel"], experience: 1 },
];

// Small and deterministic: enough seed signals for SeedJobBoardProvider's
// every-3rd-row title cycling (seedJobBoardProvider.ts) to produce 3 rows
// with a real roleKeywords title, which is enough for at least one to clear
// the 0.5 hardToFillThreshold. Kept far below S-18's load-test volumes
// (SEED_SIGNAL_COUNT=2000) on purpose — this dataset only needs to be
// visible in the demo, not to exercise throughput.
const HARD_TO_FILL_SIGNAL_COUNT = 9;

export interface SeedDemoResult {
  analytics: { inserted: number; alreadyPresent: number };
  candidates: { inserted: number; alreadyPresent: number };
  opportunities: { upserted: number };
}

export async function seedDemo(pool: Pool): Promise<SeedDemoResult> {
  const analytics = await seedAnalyticsDemo(pool);

  const { rows: existingCandidates } = await pool.query(
    "SELECT name FROM candidates WHERE name LIKE $1",
    [`${CANDIDATE_PREFIX}%`],
  );
  const existingNames = new Set(existingCandidates.map((row) => row.name as string));
  const candidatesToSeed = SEED_CANDIDATES.filter((c) => !existingNames.has(c.name));

  for (const candidate of candidatesToSeed) {
    await pool.query(
      `INSERT INTO candidates (name, skills, experience, availability, contact_info)
       VALUES ($1, $2, $3, $4, $5)`,
      [candidate.name, candidate.skills, candidate.experience, "immediate", {}],
    );
  }

  // upsertBatch's own ON CONFLICT (source, external_signal_id) DO UPDATE
  // makes this idempotent for free — a second run lands on the same rows,
  // never duplicates.
  const signals = await new SeedJobBoardProvider(HARD_TO_FILL_SIGNAL_COUNT).fetchSignals({
    timeoutMs: 5_000,
  });
  const opportunities = await upsertBatch(pool, signals);

  return {
    analytics,
    candidates: { inserted: candidatesToSeed.length, alreadyPresent: existingNames.size },
    opportunities: { upserted: opportunities.length },
  };
}

if (require.main === module) {
  (async () => {
    const pool = createPool();
    await runMigrations(pool);
    const result = await seedDemo(pool);
    // eslint-disable-next-line no-console
    console.log("seedDemo complete:", JSON.stringify(result));
    await pool.end();
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("seedDemo failed:", err);
    process.exit(1);
  });
}
