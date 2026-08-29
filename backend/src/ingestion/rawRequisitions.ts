import type { Pool } from "pg";

/**
 * Writes one append-only row to raw_requisitions (migration 015) for a
 * single fetched item, before any parsing touches it -- this is what makes
 * S-21's "raw persisted before parsing" acceptance criterion true: even if
 * the caller's parse step throws right after this returns, the raw payload
 * already survived independently.
 *
 * ON CONFLICT DO NOTHING guards the practically-impossible case of two
 * items in the same fetch landing on the identical
 * (source, external_id, fetched_at) triple (same millisecond) -- not
 * something to silently overwrite (this table is append-only by design,
 * see migration 015), just something that shouldn't crash the run.
 */
export async function persistRawRequisition(
  pool: Pool,
  source: string,
  externalId: string,
  rawResponse: unknown,
  httpStatus: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO raw_requisitions (source, external_id, raw_response, http_status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source, external_id, fetched_at) DO NOTHING`,
    [source, externalId, JSON.stringify(rawResponse), httpStatus],
  );
}
