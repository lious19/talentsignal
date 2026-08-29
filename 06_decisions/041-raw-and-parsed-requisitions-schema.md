# 041 — `raw_requisitions` (new, append-only) vs. reusing `opportunities` for parsed rows

**Date:** 2026-08-29
**Story:** S-21
**Requirement:** ticket acceptance criteria 2 (raw persisted before parsing) and 3 (idempotent
on source+external id)
**Decided by:** Megan

## The question

Where does S-21's data live — a brand-new `raw_requisitions` table for the untouched API
response, and does the *parsed*, scored side get its own new table too, or does it reuse the
existing `opportunities` table?

## What we chose, and why

**`raw_requisitions` — new table, migration `015_raw_requisitions.sql`.** This is criterion 2's
home: every fetched item is written here, verbatim, before any parsing touches it.

**Parsed/scored rows — the existing `opportunities` table, no new table.**
`05_presentations/signal-provenance-sheet.md`'s own words: *"S-21 supplies real
`MarketSignal`s... no scorer, route, or UI changes — the seam was built for exactly this."*
`opportunities` already has `UNIQUE (source, external_signal_id)` (migration `003`) and
`upsertBatch()`'s existing `ON CONFLICT ... DO UPDATE` — criterion 3's idempotency for parsed
data was **already built**, before this story started; zero schema change needed there. New
`source` values (`'greenhouse'`, `'lever'`) flow through the identical column set every
mock/seed row already uses. A second, parallel `ingested_requisitions` table would fork the one
place scoring happens into two — the same anti-pattern decision 026 already refused for
*scorers* ("do NOT build a third scorer"), applied here to *tables*.

## Amendment (Megan, before implementation): `raw_requisitions` is append-only

**Original draft (plan-mode research):** `UNIQUE (source, external_id)`, `ON CONFLICT ... DO
UPDATE` — overwrite the raw payload on every re-fetch, keeping only the latest snapshot.

**What shipped instead:** `UNIQUE (source, external_id, fetched_at)`, one row per fetch,
never overwritten. Reason: S-22's planned longitudinal diffing needs the fetch-to-fetch
*history* to compare against — a `requisition_id` reappearing, an `updated_at` moving forward,
a title changing between two fetches of the same external id. Overwriting the previous raw row
on every run would destroy exactly the history S-22 is designed to read, making S-22
unbuildable without S-21 being revisited first. Table growth is negligible for a small seed
board list (KB per ingestion run, for two boards) — this is never a table read on any
request-serving path, only by ingestion itself and (later) S-22's diffing, so unbounded growth
carries no query-latency cost today. `persistRawRequisition()`
(`backend/src/ingestion/rawRequisitions.ts`) inserts unconditionally
(`ON CONFLICT (source, external_id, fetched_at) DO NOTHING` guards only the
practically-impossible same-millisecond-same-item collision, not a real dedup path).

**What this means for criterion 3, stated precisely:** "no duplicate rows, idempotent on source
+ external id" is satisfied on the **parsed** side (`opportunities`) — a second run over the
same board produces the exact same opportunity rows, same ids, same scores, proven by
`ingestRequisitions.idempotency.test.ts`. The **raw** side intentionally does *not* dedupe on
`(source, external_id)` alone — it dedupes on the finer-grained `(source, external_id,
fetched_at)`, so a second run's rows are new, distinct historical snapshots, not the kind of
duplicate criterion 3 is about. This distinction is documented in the migration file's own
comment and the idempotency test's assertions, not left implicit.

## What this rests on

That `raw_requisitions`'s write volume (two seed boards, run manually, not on a schedule yet —
see decision 040) stays small enough that unbounded append-only growth is a non-issue. That
holds for S-21's manual-trigger scope; it may need revisiting (e.g. an archival/retention
policy) once S-22's cron wrapper exists and this table is written to on a schedule indefinitely.

## What would make this wrong

If cron ingestion (deferred past S-21, see decision 040) runs frequently enough that
`raw_requisitions`'s growth becomes a real storage or query-performance concern, this decision
needs revisiting — either a retention window, or moving to overwrite-with-a-separate-history-log
shape. Not a concern yet at S-21's manual-trigger scope.
