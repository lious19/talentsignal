import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export interface MigrationResult {
  applied: string[];
}

/**
 * Applies any .sql file in db/migrations that isn't already recorded in
 * schema_migrations, in filename order, each in its own transaction.
 *
 * Safe to call on every process start: if every migration is already
 * recorded, this is a read-only no-op. If the process crashes mid-migration,
 * that migration's transaction was never committed, so the next start
 * retries it cleanly instead of double-applying or skipping it.
 */
export async function runMigrations(pool: Pool): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations",
  );
  const alreadyApplied = new Set(rows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return { applied };
}
