-- S-21: raw requisition ingestion (Greenhouse + Lever).
--
-- Append-only, one row per fetch: the UNIQUE constraint is on
-- (source, external_id, fetched_at), not (source, external_id) alone.
-- S-22's planned longitudinal diffing needs fetch-to-fetch history to
-- detect changes (e.g. a requisition reappearing, an updated_at moving
-- forward) -- overwriting the previous raw row on every re-fetch would
-- destroy exactly the history S-22 is designed to read. Table growth is
-- negligible for a small seed board list (KB/day), and this table is never
-- read on a request-serving path, only by ingestion and future diffing --
-- no indexing/performance concern from letting it grow.
--
-- Parsed rows are NOT stored in a new table here -- they reuse the existing
-- `opportunities` table (06_decisions/041). `opportunities`'s existing
-- UNIQUE (source, external_signal_id) and upsertBatch()'s ON CONFLICT
-- already provide idempotency on the parsed side; only the raw side needed
-- a new table.
CREATE TABLE IF NOT EXISTS raw_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  raw_response JSONB NOT NULL,
  http_status INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id, fetched_at)
);

-- Supports "give me this requisition's fetch history" (S-22's eventual
-- read pattern) without a full-table scan.
CREATE INDEX IF NOT EXISTS raw_requisitions_source_external_id_idx
  ON raw_requisitions (source, external_id);
