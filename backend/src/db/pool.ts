import { Pool } from "pg";

export function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Cold-start defense in depth: docker-compose's healthcheck says Postgres is
 * ready to accept TCP connections, but that's checked with `pg_isready`
 * outside our own process. Retry the actual query a few times before giving
 * up, in case there's still a gap between "healthy" and "accepting this pool".
 */
export async function waitForDatabase(
  pool: Pool,
  retries = 10,
  delayMs = 1_000,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
