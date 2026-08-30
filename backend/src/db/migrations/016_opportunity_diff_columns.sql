-- S-22: longitudinal diffing outputs, measured from raw_requisitions history
-- (06_decisions/043 repost, 044 churn, 045 this migration) instead of seeded
-- by a single fetch. None of these three columns replace an existing one --
-- opportunities never had a days_open column before (daysOpen lived only on
-- the in-memory MarketSignal), same for repost_count/description_churn.
--
-- Unlike migrations 013/014's backfill-then-drop-default discipline, the
-- DEFAULT 0 on the three integer columns is NOT dropped: 0 is a true,
-- honestly-computed value for a row the differ hasn't measured yet ("zero
-- reposts observed" is accurate for a brand-new opportunity, not a
-- fabrication). diff_computed_at is the actual provenance marker -- NULL
-- means "predates S-22 / never diffed," distinguishing an honest zero from
-- an unmeasured one, without needing a fake sentinel value on the other
-- three columns.
ALTER TABLE opportunities
  ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN days_open INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN description_churn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN diff_computed_at TIMESTAMPTZ;
