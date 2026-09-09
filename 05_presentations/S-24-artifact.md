# S-24 artifact — capacity signals, real run

**Generated from an actual run, 2026-09-09.** Every input below is labeled
**LIVE** (a real external API/file, fetched for real), **REAL DB** (queried
directly from this run's Postgres), or would be labeled **SEEDED**/
**STUBBED** if anything here were — nothing is. Chart:
`05_presentations/S-24-artifact-basis-distribution.svg`.

## What actually ran, in order
1. `npm run ingest:capacity-once` — **LIVE**: real HTTP calls to
   `dol.gov` (H-1B LCA, FY2026 Q1 disclosure file, 73MB, streamed), the real
   USASpending.gov API (`spending_by_award` + per-award detail endpoints),
   and `sec.gov` (Form D, 2026 Q2 quarterly zip). Target company list pulled
   live from the real `opportunities` table: `["Gopuff", "GitLab"]`.
2. `npm run ingest:once` (`GREENHOUSE_BOARDS=gitlab LEVER_COMPANIES=gopuff`)
   — **LIVE**: real requisitions re-polled from GitLab's public Greenhouse
   board and gopuff's public Lever board, re-scored with `hard-to-fill-026-v3`
   against the capacity data just ingested in step 1.
3. Direct SQL queries against the real Postgres container (`docker exec
   talentsignal-db-1 psql ...`) — **REAL DB** — for every number below.

## Step 1 result: what capacity ingestion actually found, live
| Source | Real signals persisted | Real employer name(s) | Real event date(s) |
|---|---|---|---|
| H-1B LCA (FY2026 Q1) | 0 | — | — |
| Federal awards (all-time, USASpending) | **4** | `GITLAB INC.` (×3), `GITLAB B.V.` (×1) | 2015-05-07, 2016-07-20, 2016-09-26, 2017-02-06 |
| SEC Form D (2026 Q2) | 0 | — | — |

Exact rows, straight from `raw_capacity_signals` (`docker exec talentsignal-db-1 psql
-U talentsignal -d talentsignal -c "SELECT source, employer_name_raw, event_date FROM
raw_capacity_signals ORDER BY event_date;"`):
```
    source     | employer_name_raw | event_date
---------------+-------------------+------------
 federal-award | GITLAB B.V.       | 2015-05-07
 federal-award | GITLAB INC.       | 2016-07-20
 federal-award | GITLAB INC.       | 2016-09-26
 federal-award | GITLAB INC.       | 2017-02-06
```
This matches Step 0's spot-check exactly (`05_presentations/S-24-exploration.md`) — the
real API returns the same 4 real awards whether queried by hand (Step 0) or through the
real, running `FederalAwardsProvider` (this run).

## Step 2 result: real scoring pass, basis distribution across every real opportunity
1,004 real opportunities re-scored this run (232 real Greenhouse/GitLab + 772 real
Lever/gopuff). Query (`docker exec talentsignal-db-1 psql ...`, full SQL in this repo's
history):

| capacitySignal basis | count | % of 1,004 |
|---|---|---|
| **measured** (alias-table match, confidence 1.0) | **232** | 23.1% |
| **curated** (fuzzy match, 0.5–0.85 confidence) | 0 | 0% |
| **none** (no match at all) | 772 | 76.9% |
| capacitySignal contribution > 0 (net score effect) | **0** | 0% |

Every single one of the 232 "measured" matches is a real GitLab requisition whose
company name matched `GITLAB INC.`/`GITLAB B.V.` at full alias confidence — and every
single one is recency-excluded, because all 4 real underlying awards are 2015–2017,
outside the 24-month window. **Net effect on every one of today's 1,004 real scores:
zero.** Not because the mechanism didn't run — it ran, matched, and would have
contributed — but because the real evidence is too old to count as 2026 hiring intent,
exactly as the recency gate is designed to do.

As a bonus confirmation from the same run: `roleScarcity`'s "measured" basis (S-23, wired
into the live path for the first time by this story — see 06_decisions/047) fired for
**136 of the 1,004** real opportunities this run — the first time that number has ever
been real rather than zero, since `computeFamilyScarcity()` was previously never called
from the live scoring path at all.

## A real example row, verbatim
One real GitLab opportunity's actual `hard_to_fill_factors` JSONB, straight from the
database (`docker exec talentsignal-db-1 psql -U talentsignal -d talentsignal -t -c
"SELECT title, jsonb_pretty(hard_to_fill_factors -> -1) FROM opportunities WHERE
hard_to_fill_version = 'hard-to-fill-026-v3' AND company = 'GitLab' LIMIT 1;"`):

```json
{
  "basis": "measured",
  "value": 0,
  "factor": "capacitySignal",
  "weight": 0.2,
  "eventDate": "2016-09-26",
  "contribution": 0,
  "capacitySource": "federal-award",
  "recencyExcluded": true,
  "matchedEmployerName": "GITLAB INC."
}
```

The real rationale sentence this produced (`hard_to_fill_reasons`, same row):
```
role scarcity: measured (family 'ml-ai', median 76d vs global 34d) | open 20 days |
capacity: federal award matched (GITLAB INC.), high-confidence — excluded, dated
2016-09-26 is older than the 24-month recency window
```

## Two real bugs this live run caught that no unit test did
Both are fixed in this commit sequence, and both are worth naming plainly rather than
quietly folding in — this is exactly what "run it for real" is supposed to catch:

1. **USASpending 400.** `federalAwardsProvider.ts` requested `sort: "Award Amount"`
   while only asking for `fields: ["Award ID", "Recipient Name"]` — the real API
   rejects a sort field that isn't in the requested field list. Every mocked unit test
   passed regardless, because the mock never validates the request the way the real API
   does. Fixed by sorting on a requested field instead.
2. **Date object in the rationale string.** `node-postgres` parses a `DATE` column into
   a native JS `Date`, not a string, regardless of how the query is typed in TypeScript.
   Before the fix, a real capacity rationale read *"dated Mon Sep 26 2016 00:00:00
   GMT-0500 (Central Daylight Time)"* instead of *"dated 2016-09-26"* — invisible to
   every unit test, which all used string literals in a fake pool. Fixed by normalizing
   explicitly in `computeCapacitySignalLookup()`; pinned by a new regression test that
   mocks a real `Date` object.

## Honest summary
- The infrastructure is real, tested, and now proven end-to-end against real external
  APIs and a real database — not a code path that only exists in mocks.
- Today's real yield is **zero net capacity signal** across the entire live dataset —
  not a bug, the correct, verified output of applying a 24-month recency gate to real
  evidence that happens to be a decade old.
- This is expected to activate the moment the company universe grows beyond GitLab and
  gopuff, or if a future ingestion run finds a more recent filing for either company.
  Nothing here is scoped to these two companies specifically.
