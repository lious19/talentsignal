import { createPool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";
import { classifyFamily } from "../src/scoring/hardToFillScore";

/**
 * S-23 Step 2: one-off backfill for migration 018's family_key column.
 * Idempotent and resumable by construction (only ever touches rows where
 * family_key IS NULL, and each row's UPDATE commits independently), same
 * discipline as ingest-once.ts's CLI-entry shape. Run via
 * `npm run backfill:family-key`.
 *
 * Does NOT touch the ingestion write path (upsertBatch in hiddenDemand.ts) —
 * that wiring, and dropping this column's nullability, is S-23 Step 3's job,
 * once every new row is guaranteed a family_key at insert time. Until then,
 * a fresh ingestion run between Step 2 and Step 3 landing will insert rows
 * with a NULL family_key; this script is safe to re-run afterward to pick
 * those up.
 */
async function main(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);

  const { rows } = await pool.query<{ id: string; title: string }>(
    "SELECT id, title FROM opportunities WHERE family_key IS NULL",
  );

  const counts: Record<string, number> = {};
  for (const row of rows) {
    const familyKey = classifyFamily(row.title);
    await pool.query("UPDATE opportunities SET family_key = $1 WHERE id = $2", [familyKey, row.id]);
    counts[familyKey] = (counts[familyKey] ?? 0) + 1;
  }

  const { rows: remaining } = await pool.query<{ count: string }>(
    "SELECT count(*) FROM opportunities WHERE family_key IS NULL",
  );

  // eslint-disable-next-line no-console
  console.log("backfillFamilyKey complete:", JSON.stringify({ updated: rows.length, byFamily: counts, remainingNull: Number(remaining[0].count) }));
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("backfillFamilyKey failed:", err);
    process.exit(1);
  });
}
