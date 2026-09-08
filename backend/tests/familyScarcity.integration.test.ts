import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { computeFamilyScarcity } from "../src/scoring/familyScarcity";

// Needs a real Postgres with percentile_cont, so this only runs when
// DATABASE_URL is set (docker-compose, CI), same self-skip convention as
// migrate.test.ts.
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("computeFamilyScarcity (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_family_scarcity_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);

    async function seed(source: string, familyKey: string | null, daysOpen: number) {
      await scopedPool.query(
        `INSERT INTO opportunities
           (source, external_signal_id, company, title, confidence_score, reasons, weights_version,
            factor_breakdown, hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors,
            hard_to_fill_version, family_key, days_open)
         VALUES ($1, $2, 'Test Co', 'Test Title', 0, '{}', 'test', '[]'::jsonb, 0, '{}', '[]'::jsonb, 'test', $3, $4)`,
        [source, randomUUID(), familyKey, daysOpen],
      );
    }

    // ml-ai: 3 greenhouse rows (below any real threshold, but enough to prove median math)
    await seed("greenhouse", "ml-ai", 10);
    await seed("greenhouse", "ml-ai", 20);
    await seed("greenhouse", "ml-ai", 30);
    // lever rows in the SAME family -- must never affect the median
    await seed("lever", "ml-ai", 900);
    await seed("lever", "ml-ai", 1000);
    // general-other: enough rows to clear any real threshold, must still be excluded
    for (let i = 0; i < 12; i++) await seed("greenhouse", "general-other", 500);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("computes medians from greenhouse rows only, ignoring lever rows in the same family", async () => {
    const result = await computeFamilyScarcity(scopedPool);

    expect(result.byFamily["ml-ai"]).toEqual({ count: 3, medianDaysOpen: 20 });
    // If the 900/1000-day lever rows leaked in, the median would be far higher.
    expect(result.byFamily["ml-ai"].medianDaysOpen).toBeLessThan(100);
  });

  it("never includes general-other, even when it clears any real observation threshold", async () => {
    const result = await computeFamilyScarcity(scopedPool);

    expect(result.byFamily["general-other"]).toBeUndefined();
  });
});
