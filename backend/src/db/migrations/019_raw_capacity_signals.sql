-- S-24: raw capacity-signal ingestion (H-1B LCA, federal contract awards,
-- SEC Form D). A separate table from raw_requisitions on purpose -- migration
-- 018's own comment reserves raw_requisitions for requisition source-of-truth
-- (a job posting fetch), and a capacity filing (an LCA case, a contract
-- award, a Form D offering) is categorically not a requisition. Mirrors
-- raw_requisitions' append-only, one-row-per-fetch shape (015): the UNIQUE
-- constraint includes fetched_at, not just the natural key, for the same
-- reason -- a future re-run of the same source/employer/event shouldn't
-- overwrite a prior fetch's raw evidence.
--
-- employer_name_raw is deliberately never normalized here -- that's
-- matchCompany()'s job (backend/src/matching/companyMatch.ts), kept separate
-- so the raw table always holds exactly what the source filed, unaltered.
-- event_date is nullable: not every source's date field is guaranteed
-- present for every real row (e.g. a Form D offering can be YETTOOCCUR).
-- role_title/soc_code are LCA-only fields, null for the other two sources --
-- federal awards and Form D carry no occupation data at all (06_decisions/047).
CREATE TABLE IF NOT EXISTS raw_capacity_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  employer_name_raw TEXT NOT NULL,
  event_date DATE,
  role_title TEXT,
  soc_code TEXT,
  raw_response JSONB NOT NULL,
  http_status INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id UUID,
  UNIQUE (source, employer_name_raw, event_date, fetched_at)
);

-- Supports the scoring-time lookup (computeCapacitySignalLookup) and any
-- future "what did we already ingest for this employer" check without a
-- full-table scan.
CREATE INDEX IF NOT EXISTS raw_capacity_signals_source_employer_idx
  ON raw_capacity_signals (source, employer_name_raw);
