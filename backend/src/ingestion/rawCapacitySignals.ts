import type { Pool } from "pg";

export interface PersistedRawCapacitySignalRow {
  id: string;
  fetchedAt: Date;
}

/**
 * Writes one append-only row to raw_capacity_signals (migration 019) --
 * mirrors persistRawRequisition() (rawRequisitions.ts) exactly, one level
 * removed: a capacity filing, not a job posting. Same ON CONFLICT DO NOTHING
 * guard against a same-millisecond collision on the natural key.
 */
export async function persistRawCapacitySignal(
  pool: Pool,
  source: string,
  employerNameRaw: string,
  eventDate: string | null,
  roleTitle: string | undefined,
  socCode: string | undefined,
  rawResponse: unknown,
  httpStatus: number,
  runId: string,
): Promise<PersistedRawCapacitySignalRow> {
  const { rows } = await pool.query(
    `INSERT INTO raw_capacity_signals
       (source, employer_name_raw, event_date, role_title, soc_code, raw_response, http_status, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, employer_name_raw, event_date, fetched_at) DO NOTHING
     RETURNING id, fetched_at`,
    [source, employerNameRaw, eventDate, roleTitle ?? null, socCode ?? null, JSON.stringify(rawResponse), httpStatus, runId],
  );

  if (rows.length > 0) {
    return { id: rows[0].id as string, fetchedAt: new Date(rows[0].fetched_at as string) };
  }

  const { rows: existingRows } = await pool.query(
    `SELECT id, fetched_at FROM raw_capacity_signals
      WHERE source = $1 AND employer_name_raw = $2 AND run_id = $3
      ORDER BY fetched_at DESC LIMIT 1`,
    [source, employerNameRaw, runId],
  );
  return {
    id: existingRows[0].id as string,
    fetchedAt: new Date(existingRows[0].fetched_at as string),
  };
}
