import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { seedDemo } from "../src/db/seedDemo";

/**
 * S-19 acceptance: "the seed command ... populates a fixed demo dataset ...
 * identically every run." A fake pool can't prove this — idempotency here
 * means real Postgres ON CONFLICT / skip-existing behavior actually holds,
 * so this needs a genuine database, same describeIfDb gate as every other
 * *.integration.test.ts file.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("seedDemo idempotency (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_seed_demo_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it(
    "produces a fixed dataset on the first run, and adds nothing new on a second run",
    async () => {
      const first = await seedDemo(scopedPool);
      expect(first.analytics.inserted).toBeGreaterThan(0);
      expect(first.candidates.inserted).toBeGreaterThan(0);
      expect(first.opportunities.upserted).toBeGreaterThan(0);

      const { rows: clientCountFirst } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM clients WHERE name LIKE 'Seed Analytics Client%'",
      );
      const { rows: candidateCountFirst } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM candidates WHERE name LIKE 'Seed Demo Candidate%'",
      );
      const { rows: opportunityRowsFirst } = await scopedPool.query(
        "SELECT id, confidence_score, hard_to_fill_score FROM opportunities WHERE source = 'seed-job-board' ORDER BY id",
      );

      const second = await seedDemo(scopedPool);
      // Every seed row already exists — a second run inserts zero new
      // clients/candidates, and upsertBatch's ON CONFLICT updates the same
      // opportunity rows in place rather than creating duplicates.
      expect(second.analytics.inserted).toBe(0);
      expect(second.candidates.inserted).toBe(0);
      expect(second.opportunities.upserted).toBe(first.opportunities.upserted);

      const { rows: clientCountSecond } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM clients WHERE name LIKE 'Seed Analytics Client%'",
      );
      const { rows: candidateCountSecond } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM candidates WHERE name LIKE 'Seed Demo Candidate%'",
      );
      const { rows: opportunityRowsSecond } = await scopedPool.query(
        "SELECT id, confidence_score, hard_to_fill_score FROM opportunities WHERE source = 'seed-job-board' ORDER BY id",
      );

      expect(clientCountSecond).toEqual(clientCountFirst);
      expect(candidateCountSecond).toEqual(candidateCountFirst);
      // Same ids, same scores — the exact "identically every run" claim.
      expect(opportunityRowsSecond).toEqual(opportunityRowsFirst);

      // At least one seeded opportunity clears the hard-to-fill threshold —
      // otherwise this "seed" would satisfy row counts while still leaving
      // HF-2/HF-3 with nothing to show, which is the whole point of routing
      // this through the real scorer instead of a hand-picked score.
      const { rows: hardToFillRows } = await scopedPool.query(
        "SELECT id FROM opportunities WHERE source = 'seed-job-board' AND hard_to_fill_score::numeric >= 0.5",
      );
      expect(hardToFillRows.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
