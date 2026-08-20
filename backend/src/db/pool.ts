import { Pool } from "pg";

export function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    idleTimeoutMillis: 30_000,
    // Unset by default -> pg's own default of 10, today's real (undocumented
    // until now) behavior. S-18's load validation found this is the actual
    // concurrency ceiling for every DB-touching endpoint well below REQ-017's
    // 1000-concurrent target; DB_POOL_MAX lets a comparison run raise it
    // without a code change. See 06_decisions/028 for the proposed value and
    // why it isn't hardcoded higher here.
    max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined,
    // Off by default (06_decisions/023): the demo's app<->Postgres traffic
    // stays inside the Docker Compose private network, never encrypted
    // today. This exists so a production deployment against a
    // network-separated Postgres can turn on TLS via one env var, without
    // a code change — it is not itself proof that transit encryption is
    // running anywhere right now.
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
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
