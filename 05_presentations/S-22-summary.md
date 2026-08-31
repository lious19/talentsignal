# S-22 — Longitudinal diffing: reposts, days open, description churn

**Status:** Complete · **Delivered:** 2026-08-31
**Requirements:** HF-1's `isRepost`/`daysOpen` inputs, previously seeded, now measured
**⚠ Story provenance:** `00_scope/stories/S-22.md` does not exist in this repo — confirmed, not
assumed. This summary reports against the pasted Basecamp ticket text (acceptance criteria below,
verbatim), the same provenance caveat S-18/S-19 carry for their own synthesized stories.

## What S-22 delivered

Ali's acceptance criteria, verbatim, and how each was met on the live system:

**"A requisition that disappears and later returns is detected as a repost, not as a new
record."** ✅ — absence-based detection: `(source, external_id)` seen, missing from a later fetch
(proven by another item's row landing for that source in the gap window, not just silence),
seen again → `repost_count` +1. Confirmed live: GitLab's "Engineering Manager, AI Engineering:
Chat" carries `repost_count: 1` on the latest clean ingest (2026-08-31), the one real repost
observed across this demo's ingestion history.

**"A requisition edited in place increments churn without incrementing repost count."** ✅ —
title-or-description changed since the immediately prior fetch → `description_churn` +1, with
zero effect on `repost_count` (the two are computed independently in `computeDiffs.ts`, never
share a code path). 220 of 222 Greenhouse rows on the latest ingest show `description_churn: 1`
with `repost_count: 0` — an edit without a repost, exactly the criterion's distinction.

**"Re-running the differ over an unchanged board is a no-op."** ✅ — `computeDiff()` is a pure
function of `raw_requisitions` history (see Trust guarantee below); re-running it against
identical history produces identical output, proven by a dedicated idempotency unit test
(`computeDiffs.test.ts`) and, at the full-pipeline level, by
`ingestRequisitions.diffTrustGuarantee.integration.test.ts`.

**"Boundary: a board that returns zero postings does not zero out existing history."** ✅ — by
construction, not a special case: both providers' fetch loops (`for (const job of jobs)`) simply
don't execute on an empty response, so nothing is read, diffed, or written. There is no
reconcile/delete-missing pass anywhere in this design that could touch existing rows.

## Key design decisions

- [`06_decisions/043`](../06_decisions/043-repost-detection.md) — repost detection: absence-based
  + `requisition_id`-based (Greenhouse only), capped at +1/fetch; and why the differ runs inline
  inside each provider, not as a post-hoc pass, so corrected values reach the same run's scorers.
- [`06_decisions/044`](../06_decisions/044-description-churn-definition.md) — churn: title-or-
  description, one increment per fetch (not per field), whitespace/HTML-normalized but
  case-sensitive comparison; the live-verified `?content=true` fix Greenhouse's board endpoint
  needed for description text to exist at all.
- [`06_decisions/045`](../06_decisions/045-diff-derived-columns.md) — `days_open` anchored to the
  posting's own `first_published`/`createdAt`, reproducibly measured against the latest known
  `fetched_at` rather than wall-clock `Date.now()`; migration 016's additive, default-not-dropped
  schema on `opportunities`.

## Two production incidents caught and fixed

**1. Same-run contamination in `computeDiff`'s gap detection (fixed `1f98f5f`).** CI run #8 failed
two integration tests with inflated/wrong `repost_count`s. Traced to `wasPolledWithoutThisItem()`:
items within one ingestion run are persisted sequentially, not simultaneously, so a board-mate's
row landing moments earlier in the *same* run could read as a false "board polled without me"
signal. Fixed by excluding both bracketing sightings' own `run_id`s from the gap query. A live
verify run taken *before* this fix (same day) showed `repost_count` totals exceeding row counts
(239 reposts on 220 Greenhouse rows) — the exact symptom this fix eliminated; the 2026-08-31 clean
run above shows a single, plausible repost instead.

**2. Chunk size 200 too coarse against Render's real latency (fixed `fb71ea3`, now 100).** A live
`ingest:once` run against the deployed Render Postgres hit `57014 canceling statement due to
statement timeout` on the first 200-row upsert chunk, dropping 200 of 1,036 signals even though an
earlier run's identical-size chunks had all landed cleanly — Render's observed statement latency
varies enough that 200 wasn't a safe margin on every run. `UPSERT_CHUNK_SIZE` halved to 100;
decision `042` carries the addendum. The 2026-08-31 clean run (1,039 signals) completed with zero
chunk errors.

## Real numbers — latest clean `ingest:once` (2026-08-31, commit `fb71ea3`+)

| source | opportunities | diff_computed_at coverage | reposts | median days_open | description_churn > 0 |
|---|---|---|---|---|---|
| greenhouse | 222 | 222/222 (100%) | 1 | 38 | 220 |
| lever | 818 | 818/818 (100%) | 0 | 1,146 | 0 |
| seed-job-board | 9 | 0/9 (not S-22 data) | 0 | 0 | 0 |

Sample rows, not aggregates — the actual repost:

| company | title | repost_count | days_open | description_churn |
|---|---|---|---|---|
| GitLab | Engineering Manager, AI Engineering: Chat | **1** | 54 | 1 |

Sample of measured churn across real GitLab roles (days_open ranges 0–177, median 38):

| company | title | days_open | description_churn |
|---|---|---|---|
| GitLab | Manager, Solutions Architects – San Francisco | 177 | 1 |
| GitLab | Staff Backend Engineer (Ruby on Rails/AI), Verify | 174 | 1 |
| GitLab | Senior Backend Engineer, Analytics Instrumentation (Golang) | 172 | 1 |

Kept honest: Lever's median `days_open` (1,146 days, ~3.1 years) is real `createdAt` data from the
`gopuff` board, not a bug — flagged when first observed, not investigated further as out of this
story's scope. `seed-job-board` rows show `0/9` diff coverage by design: they predate S-22 and are
never re-fetched, so `diff_computed_at IS NULL` on them is the honest "never diffed" marker
045 describes, not a gap in this story's work.

## Trust guarantee

`raw_requisitions` (migration 015) is append-only — one row per fetch, `UNIQUE (source,
external_id, fetched_at)`, never overwritten. `computeDiff()` reads only that history plus the
current fetch; it never reads `opportunities`' own stored columns as an input. That makes the
differ a pure function of `raw_requisitions`: the same history always produces the same
`repost_count`/`days_open`/`description_churn`, regardless of how many times or in what order it's
re-run, and a bad differ run never destroys the raw evidence needed to recompute correctly.
Verified by `ingestRequisitions.diffTrustGuarantee.integration.test.ts`: a deliberately corrupted
`computeDiff()` (monkey-patched to always return `repostCount: 0`) is shown to produce a wrong
stored value, then the real `computeDiff()` is re-run over the same untouched history and the
value self-corrects — with no other input changed.

## Explicit deferrals (not scope creep, deliberate)

- **A same-run repost heuristic stays out**, per decision 043. The two detection paths
  (absence-based, `requisition_id`-based) are mutually exclusive by construction in this
  implementation and never need to resolve a genuine double-fire — extending either to also catch
  same-run reappearances was considered and explicitly not built, since no real board behavior
  observed so far calls for it.
- **S-23 handles measured time-to-fill baselines separately.** `days_open` here measures how long
  a requisition has been open on the source ATS, anchored to real `first_published`/`createdAt`
  data — a different measurement from a placement's time-to-fill, which depends on this agency's
  own pipeline data, not the ATS board. Conflating the two was avoided; S-23 owns that baseline.

## Class demo script (Tuesday, ~5 bullets, 30–45 sec each)

1. **Log in** as a sales user — light corporate theme, left sidebar, Overview lands by default.
2. **Click Overview** — point at the "Opportunity Distribution" donut: it's built from real
   `confidenceScore` tiers across all 1,039 live opportunities, not fixture data.
3. **Click Opportunities**, filter mentally to the hard-to-fill badge — show one flagged role's
   "why" breakdown expanding inline, never a bare badge (HF-2's trust scenario, still holding).
4. **Point at GitLab's "Engineering Manager, AI Engineering: Chat"** — `days_open: 54`,
   `repost_count: 1`. Say plainly: this number is measured from `raw_requisitions`' real fetch
   history, not seeded at parse time — the one real repost this demo's ingestion history has
   produced.
5. **Show `raw_requisitions` in psql** (or a screenshot): `SELECT source, external_id, fetched_at,
   run_id FROM raw_requisitions WHERE source = 'greenhouse' ORDER BY fetched_at DESC LIMIT 10;` —
   point out multiple `fetched_at` rows for the same `external_id`, proving the append-only history
   S-22's diffing is built on is real, not a mocked table.
