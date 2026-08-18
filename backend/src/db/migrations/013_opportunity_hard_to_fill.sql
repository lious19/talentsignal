-- HF-2 (BUILDOUT-hard-to-fill.md): surface the hard-to-fill score HF-1 already
-- computes (hardToFillScore.ts) on the opportunity itself, so the sales-facing
-- board can badge it. This is a SECOND, independent score living alongside the
-- confidence columns 005 added — it never touches confidence_score/reasons/
-- factor_breakdown, and scoreSignal() stays the one and only place a confidence
-- number is produced (the "one place per score" discipline from S-07 / 026).
--
-- Column shapes mirror the confidence pair exactly so the two scores read and
-- audit the same way:
--   hard_to_fill_score    NUMERIC(4,3)  — bounded [0,1] by construction (026)
--   hard_to_fill_reasons  TEXT[]        — plain-English "why", like reasons
--   hard_to_fill_factors  JSONB         — weight/value/contribution breakdown
--   hard_to_fill_version  TEXT          — stamps HARD_TO_FILL_CONFIG.version (026/012)
--
-- Known, accepted gap (same as 005's): rows written before this migration have
-- no persisted raw signal (title/daysOpen/isRepost) to recompute a real
-- hard-to-fill score from, so they are backfilled with an explicit
-- "unversioned-backfill" marker (score 0, empty reasons/factors) rather than a
-- fabricated one. A score of 0 is below HARD_TO_FILL_CONFIG.hardToFillThreshold
-- (0.5), so a backfilled row correctly reads as "not flagged hard to fill"
-- rather than a false badge. The demo runs from a freshly migrated, empty
-- database, so no backfilled row is ever visible at demo time.
ALTER TABLE opportunities
  ADD COLUMN hard_to_fill_score NUMERIC(4,3) NOT NULL DEFAULT 0,
  ADD COLUMN hard_to_fill_reasons TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN hard_to_fill_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN hard_to_fill_version TEXT NOT NULL DEFAULT 'unversioned-backfill';

-- Drop the defaults once existing rows are backfilled: every future insert
-- (upsertBatch in hiddenDemand.ts) must supply all four columns explicitly,
-- never silently fall back to a value that claims "no hard-to-fill score" for
-- a fresh opportunity.
ALTER TABLE opportunities ALTER COLUMN hard_to_fill_score DROP DEFAULT;
ALTER TABLE opportunities ALTER COLUMN hard_to_fill_reasons DROP DEFAULT;
ALTER TABLE opportunities ALTER COLUMN hard_to_fill_factors DROP DEFAULT;
ALTER TABLE opportunities ALTER COLUMN hard_to_fill_version DROP DEFAULT;
