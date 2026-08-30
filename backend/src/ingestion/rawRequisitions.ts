import type { Pool } from "pg";

export interface PersistedRawRow {
  id: string;
  fetchedAt: Date;
}

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
 *
 * S-22 addition: returns the persisted row's id/fetched_at (migration 017
 * adds run_id) instead of void, so the caller can hand computeDiffs.ts an
 * exact row to diff against -- excluding it from its own prior-history
 * query by id, and anchoring days_open to the real fetched_at Postgres
 * assigned rather than a separately-read wall-clock timestamp.
 */
export async function persistRawRequisition(
  pool: Pool,
  source: string,
  externalId: string,
  rawResponse: unknown,
  httpStatus: number,
  runId: string,
): Promise<PersistedRawRow> {
  const { rows } = await pool.query(
    `INSERT INTO raw_requisitions (source, external_id, raw_response, http_status, run_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source, external_id, fetched_at) DO NOTHING
     RETURNING id, fetched_at`,
    [source, externalId, JSON.stringify(rawResponse), httpStatus, runId],
  );

  if (rows.length > 0) {
    return { id: rows[0].id as string, fetchedAt: new Date(rows[0].fetched_at as string) };
  }

  // The practically-impossible same-millisecond collision: the INSERT above
  // was skipped, so re-read the row that already occupies this
  // (source, external_id, fetched_at) triple rather than leaving the caller
  // with nothing to diff against.
  const { rows: existingRows } = await pool.query(
    `SELECT id, fetched_at FROM raw_requisitions
      WHERE source = $1 AND external_id = $2 AND run_id = $3
      ORDER BY fetched_at DESC LIMIT 1`,
    [source, externalId, runId],
  );
  return {
    id: existingRows[0].id as string,
    fetchedAt: new Date(existingRows[0].fetched_at as string),
  };
}
