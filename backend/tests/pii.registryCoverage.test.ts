import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";

// Requires a real Postgres — the whole point is checking what's actually in
// information_schema against what's actually in pii_fields, which a fake
// pool can't meaningfully stand in for. Same throwaway-schema pattern as
// migrate.test.ts.
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// Heuristic over column *names*, not column *contents* — see 06_decisions/009
// and the plan note on this test's disclosed limitation (a column like
// `notes` that happens to hold personal data in free text wouldn't match).
// That's a real gap shared by every schema-level PII-tagging approach; what
// this catches is the concrete failure mode this story exists to prevent:
// forgetting to register an obviously-named PII column at all.
const PII_NAME_PATTERN = /email|phone|contact|address|ssn|dob|name/i;

const REVIEWED_NOT_PII: { table: string; column: string; reason: string }[] = [
  { table: "clients", column: "name", reason: "company name, not personal data" },
];

function isReviewedNotPii(table: string, column: string): boolean {
  return REVIEWED_NOT_PII.some((entry) => entry.table === table && entry.column === column);
}

describeIfDb("pii_fields registry coverage (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_pii_${randomUUID().replace(/-/g, "_")}`;
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

  it("every PII-shaped column name is either registered or a reviewed exception", async () => {
    const { rows: columns } = await scopedPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name IN ('clients', 'candidates', 'job_openings')`,
      [schemaName],
    );
    const { rows: registered } = await scopedPool.query<{
      table_name: string;
      column_name: string;
    }>("SELECT table_name, column_name FROM pii_fields");
    const registeredSet = new Set(registered.map((row) => `${row.table_name}.${row.column_name}`));

    const suspects = columns.filter((col) => PII_NAME_PATTERN.test(col.column_name));
    expect(suspects.length).toBeGreaterThan(0); // sanity check: the heuristic finds *something*

    const unaccountedFor = suspects.filter(
      (col) =>
        !registeredSet.has(`${col.table_name}.${col.column_name}`) &&
        !isReviewedNotPii(col.table_name, col.column_name),
    );
    expect(unaccountedFor).toEqual([]);
  });

  it("every registered pii_fields row points at a real, currently-existing column", async () => {
    const { rows: registered } = await scopedPool.query<{
      table_name: string;
      column_name: string;
    }>("SELECT table_name, column_name FROM pii_fields");
    const { rows: columns } = await scopedPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1`,
      [schemaName],
    );
    const columnSet = new Set(columns.map((col) => `${col.table_name}.${col.column_name}`));

    const stale = registered.filter((row) => !columnSet.has(`${row.table_name}.${row.column_name}`));
    expect(stale).toEqual([]);
  });
});
