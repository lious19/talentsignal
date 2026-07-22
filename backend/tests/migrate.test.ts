import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";

// Idempotency needs a real Postgres, so this only runs when DATABASE_URL is
// set (docker-compose, CI) and is skipped for a plain `npm test` on a laptop
// with no database running.
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("runMigrations (integration, requires DATABASE_URL)", () => {
  // A throwaway schema, not the shared database: this test asserts both
  // that migrations genuinely get applied AND that a second run applies
  // nothing. The first half only means anything against a schema we know is
  // pristine — testing it against whatever the shared dev/CI database
  // happens to already contain makes the result a coin flip on start-up
  // ordering, since some other process may have already migrated it.
  const schemaName = `test_migrate_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    // search_path is applied by Postgres to every connection this pool
    // opens, so migrate.ts's unqualified table names (schema_migrations,
    // users, app_meta) resolve inside the throwaway schema without migrate.ts
    // knowing anything about it.
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("applies every migration against a pristine schema, then applies nothing on a second run", async () => {
    const first = await runMigrations(scopedPool);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = await runMigrations(scopedPool);
    expect(second.applied).toEqual([]);
  });
});
