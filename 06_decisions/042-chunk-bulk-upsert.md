# 042 — Chunk `upsertBatch`'s bulk insert into batches of 200

**Date:** 2026-08-29
**Story:** S-21 (hotfix, discovered on the first live ingestion run)
**Requirement:** ticket acceptance criteria 1/3 (a real requisition lands in Postgres;
idempotent re-runs) — this fixes a real run that fetched successfully but failed to write.
**Decided by:** Megan

## The question

The first live `npm run ingest:once` run against the deployed Render Postgres fetched 220
real Greenhouse postings and 816 real Lever postings successfully (`raw_requisitions` got all
1,036 rows), but the run then failed at the final step — Postgres error `57014 canceling
statement due to statement timeout` — and zero of those 1,036 signals landed in `opportunities`.
What should change so a batch this size can actually finish?

## What we chose, and why

**Root cause, verified by reading the code, not guessed:** `upsertBatch()` in
`backend/src/routes/hiddenDemand.ts` writes the entire batch in ONE SQL statement via
`unnest()` — deliberately, so a batch is atomic (decision noted in the function's own original
comment: "a batch either fully upserts or fully fails, never half-applies"). `pool.ts` sets a
hardcoded `statement_timeout: 5000` (5 seconds) on every connection. Every batch this timeout
was ever tested against before today — the 9-row `seed:demo` dataset, the largest test fixture
(500 mock signals, all in-memory, no real network) — comfortably finished inside 5s. 1,036 real
rows over the real network hop to Render's managed Postgres did not.

**Fix: split the signal list into chunks of `UPSERT_CHUNK_SIZE = 200` and upsert each chunk as
its own `unnest()` statement, sequentially.** `upsertChunk()` is the old `upsertBatch()` body,
unchanged, just renamed and scoped to one chunk. The new `upsertBatch()` is a thin loop over
`upsertChunk()`. Sequential, not `Promise.all` — the ingestion pool is shared with
request-serving traffic, and there's no latency budget here that justifies opening several
concurrent connections against it at once.

**Chunk-level failure isolation, not batch-level:** if one chunk's `INSERT` throws (a
timeout, a constraint violation, anything), that error is logged with the chunk's starting
index and size, and the loop continues to the next chunk rather than aborting the whole run.
This mirrors 06_decisions/040's board-level isolation principle exactly: a run that upserts 800
of 1,000 signals is strictly better than one that upserts zero because row 850 had a bad value.
This is a real behavior change from the original "atomic batch" comment — the tradeoff is
explicit here, not silent: **the whole batch no longer commits as one transaction.** A batch
that partially lands means the previous "fully upserts or fully fails" invariant now applies
per chunk, not per call. That's the correct tradeoff for this story: idempotency (criterion 3)
still holds per-chunk (`ON CONFLICT ... DO UPDATE` inside each chunk is unchanged), and a
re-run after a partial failure safely re-upserts everything, including rows that already
landed, with no duplicates.

**Chunk size = 200, not raised further or lower:** ~5x the largest chunk size (500, all
in-memory) ever proven safe under the existing 5s timeout in tests, with headroom on the
assumption that real network latency to Postgres adds meaningful overhead a mocked pool never
does. 200 splits the actual 1,036-row failure into 6 chunks (200×5 + 36), each comfortably
smaller than the 500-row size already proven fast in-memory.

**Explicitly rejected: raising `statement_timeout`.** That's set once on the whole pool
(`pool.ts`), shared by every query this app runs, not just `upsertBatch`. Raising it to
"whatever the biggest expected ingestion batch needs" would silently raise the ceiling for
every other query too — including ones where a slow query genuinely should time out and surface
as an error, not hang. It also doesn't fix the underlying scalability shape: a bigger single
statement over a slow network is still one long-running transaction holding a connection open
that whole time. Chunking is the fix that actually scales as ingestion volume grows (S-22's
future cron wrapper, more boards); a bigger timeout just moves the ceiling out one time.

## What this rests on

That 200 rows' worth of `unnest()` INSERT work, over the real network latency to Render's
managed Postgres, reliably completes well inside 5 seconds. Not yet measured directly against
the live Render DB (only inferred from the 500-row in-memory test and the fact that 1,036 rows
failed) — the real proof is Angel's next `ingest:once` run against the live DB landing rows in
`opportunities` (this decision doc explicitly asks for that as the verification step, not a
local test run).

## What would make this wrong

If a single 200-row chunk is ever observed to approach or exceed the 5s `statement_timeout` on
its own (visible as a `57014` error on one specific chunk in the logs, with the failing chunk's
`chunkStart`/`chunkSize` in the log line), `UPSERT_CHUNK_SIZE` needs to come down further — 100,
or lower, depending on what the real latency profile turns out to be once measured. If ingestion
volume grows enough (many more boards, S-22's cron running frequently) that a full batch's total
chunk count makes the sequential loop itself the bottleneck (a run taking minutes end-to-end
because of many small chunks, each waiting on the last), that's a signal to reconsider bounded
parallelism — not attempted here, since a single first fix should prove the failure mode is
actually gone before adding more complexity.

## Addendum, 2026-08-31: chunk size lowered 200 -> 100

Exactly the failure mode this doc flagged as the "what would make this wrong" case actually
happened: the second live `ingest:once` run against Render's deployed Postgres hit `57014
canceling statement due to statement timeout` on `chunkStart:0, chunkSize:200` — one full
200-row chunk timed out and was dropped (`opportunitiesUpserted: 836` instead of 1036), even
though the first run's chunks had all landed cleanly. Increased resolution needed because 200
was empirically too coarse on Render's observed latency variance — the same chunk size that
worked on run 1 didn't reliably clear the 5s ceiling on run 2, so headroom, not just a one-time
measurement, is what this number needs to encode. `UPSERT_CHUNK_SIZE` is now 100 (halving the
per-statement row count, doubling the number of sequential round trips for a given batch size).
Chunk-level failure isolation (above) meant this degraded gracefully rather than losing the
whole run — but a dropped chunk is still silently-missing data until the next re-run picks it
up, so this is worth watching for a repeat even at 100.
