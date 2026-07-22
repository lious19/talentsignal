import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";

// Idempotency needs a real Postgres, so this only runs when DATABASE_URL is
// set (docker-compose, CI) and is skipped for a plain `npm test` on a laptop
// with no database running.
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("runMigrations (integration, requires DATABASE_URL)", () => {
  it("is idempotent: a second run applies nothing", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      const first = await runMigrations(pool);
      expect(first.applied.length).toBeGreaterThan(0);

      const second = await runMigrations(pool);
      expect(second.applied).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
