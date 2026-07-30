-- S-07 (REQ-003): make the confidence score auditable and versioned, without
-- introducing a second scorer. weights_version stamps every row with the
-- CONFIDENCE_CONFIG.version that produced its score (06_decisions/012), so a
-- stored score stays traceable after those weights later change.
-- factor_breakdown carries the structured weight/value/contribution array
-- scoreSignal() already computes, replacing the plain reasons strings as the
-- source a manager audits.
--
-- Known, accepted gap (06_decisions/012): rows written before this migration
-- have no raw signal (daysOpen/isRepost/hasSalaryRange) persisted anywhere,
-- only the derived confidence_score/reasons — there is nothing to recompute
-- a real breakdown from. Those rows are backfilled below with a value that
-- says so explicitly ('unversioned-backfill', an empty breakdown) rather
-- than a fabricated one. The demo runs from a freshly migrated, empty
-- database so no such row is ever visible at demo time.
ALTER TABLE opportunities
  ADD COLUMN weights_version TEXT NOT NULL DEFAULT 'unversioned-backfill',
  ADD COLUMN factor_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Drop the defaults once existing rows are backfilled: every future insert
-- (upsertBatch in hiddenDemand.ts) must supply both columns explicitly, never
-- fall back to a value that silently claims "no breakdown" for a fresh score.
ALTER TABLE opportunities ALTER COLUMN weights_version DROP DEFAULT;
ALTER TABLE opportunities ALTER COLUMN factor_breakdown DROP DEFAULT;
