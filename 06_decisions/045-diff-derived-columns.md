# 045 — `days_open` computation, and the diff-derived columns on `opportunities`

**Date:** 2026-08-30
**Story:** S-22
**Requirement:** ticket acceptance criteria 1-4, and the boundary "existing history isn't
zeroed by an empty response"
**Decided by:** Megan, approved from a plan-mode research pass

## The question

Where `days_open` should be measured from, now that it needs to be a real, persisted,
re-derivable value rather than a value computed once at parse time against wall-clock
`Date.now()`; and what schema change carries `repost_count`/`days_open`/`description_churn`
onto `opportunities`.

## What we chose, and why (`days_open`)

**The posting's own `first_published` (Greenhouse) / `createdAt` (Lever) — unchanged from
S-21 — anchored to the LATEST KNOWN `fetched_at` for that item, not wall-clock
`Date.now()`.** 06_decisions/040 already established these fields as real, accurate,
single-fetch data (not seeded placeholders); pure fetched-at-diffing (comparing only two
poll timestamps, ignoring the posting's own opened date) would *understate* `days_open` for
weeks after this story ships — a posting that's actually been open 60 days but is only
fetched for the first time today would read `days_open = 0` under that approach, a strictly
worse number than what S-21 already computed. The real defect in the pre-S-22 code was
anchoring to `Date.now()`: re-running the differ tomorrow with zero new fetches would
silently change `days_open`, which violates criterion 3's "no-op on an unchanged board" in
spirit even though no *data* changed. Anchoring to the latest `fetched_at` instead fixes
that drift while keeping the real `first_published`/`createdAt` anchor.

**Note acknowledging the tension with the provenance sheet:**
`05_presentations/signal-provenance-sheet.md` frames `daysOpen` as something S-22 "computes
by tracking a posting over time," which read narrowly could imply discarding
`first_published`/`createdAt` entirely in favor of pure fetch-history diffing. This
decision's position is that 040 was right about the *source field* — the provenance sheet's
framing is really about reproducibility/anchoring, not about needing a different data
source. Recorded here explicitly since it partially refines what the provenance sheet
implied to Ali, rather than silently picking a reading and moving on.

## What we chose, and why (schema)

No new table — additive columns on `opportunities` (migration 016):

```sql
ALTER TABLE opportunities
  ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN days_open INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN description_churn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN diff_computed_at TIMESTAMPTZ;
```

None of the three integer columns "replace" an existing field — `opportunities` never had a
`days_open` column before this migration; `daysOpen` lived only on the transient, in-memory
`MarketSignal`. Unlike migrations 013/014's backfill-then-drop-default discipline, the
`DEFAULT 0` here is **not dropped**: `0` is an honestly-computed value for a row the differ
hasn't measured yet ("zero reposts observed so far" is true, not fabricated, for a
brand-new opportunity). `diff_computed_at` is the real provenance marker — `NULL` means
"predates S-22 or was never diffed," which is what distinguishes an honest zero from an
unmeasured one, without needing a fake sentinel on the other three columns the way 013/014
needed `'unversioned-backfill'`.

`raw_requisitions` also gained a column this story (migration 017, `run_id`) — see
06_decisions/043 for why: absence-based repost detection needs to know which fetches
happened for a source as a whole, which a per-item `fetched_at` alone can't answer.

## What this rests on

Same as 041's own caveat: `raw_requisitions`'s history stays small enough (two seed boards,
manually triggered) that reading full per-item history on every fetch (`computeDiff()`'s
query pattern) doesn't become a real latency concern before this gets revisited.

## What would make this wrong

If Ali reads the provenance sheet's framing literally and wants `days_open` computed purely
from fetch-history diffing regardless of the understatement tradeoff on early runs. If
`diff_computed_at IS NULL` needs to be surfaced more visibly in the UI than "the three
integer columns happen to read 0" — that's a frontend decision this story doesn't make.
