-- S-22 addition discovered during implementation (mirrors 06_decisions/042's
-- own precedent: a gap found while building, not predicted in advance).
--
-- raw_requisitions (migration 015) records PRESENCE only -- one row per item
-- actually returned by a fetch. Absence-based repost detection (criterion 1:
-- "disappears and later returns") needs to tell apart "this item's board was
-- polled and it genuinely wasn't there" from "this item's board was simply
-- never polled again" -- and a bare fetched_at timestamp on each item's own
-- rows can't answer that alone, since an item with no row at time T could
-- mean either. run_id ties every row persisted during one ingestRequisitions()
-- call to that call's correlationId, so the differ can ask "did ANY other row
-- for this source get written under a run this item has no row in" -- a real
-- signal that a poll happened and the item was missing from it, not a guess
-- from timestamps alone. See 06_decisions/043.
--
-- Nullable: old rows written before this migration (S-21's original runs)
-- have no run_id to backfill from, and are simply excluded from gap-window
-- queries (WHERE run_id IS NOT NULL) rather than given a fabricated one.
ALTER TABLE raw_requisitions ADD COLUMN run_id UUID;

-- Supports computeDiffs.ts's gap-window query: "which runs of this source
-- happened between two of an item's own fetches" (WHERE source = ... AND
-- fetched_at BETWEEN ...).
CREATE INDEX IF NOT EXISTS raw_requisitions_source_fetched_at_idx
  ON raw_requisitions (source, fetched_at);
