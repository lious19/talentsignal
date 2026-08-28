# 039 — Frontend opts back into seed data for the deployed demo

**Date:** 2026-08-28
**Story:** S-20
**Requirement:** demo-readiness for Ali's Phase 3 review (unblocks the empty Opportunities page
after Angel's seed run against the live Render Postgres)
**Decided by:** Megan (hotfix)

## The question

`backend/src/routes/hiddenDemand.ts` (and `hardToFillTargeting.ts`) exclude
`source = 'seed-job-board'` rows by default, opting back in only via
`?includeSeedData=true` (decision 028's fix for S-18's load-test visibility gap). The frontend
never sent that flag on any of its calls, so after Angel's `seed:demo` run populated the live
Render Postgres with 26 clients, 6 candidates, and 9 hard-to-fill seed opportunities, the
deployed Opportunities board — and every other screen that reads the same endpoint — still
showed empty, because every seeded row was silently filtered out by the backend's own default.

## What we chose, and why

Add `?includeSeedData=true` to every frontend fetch that hits an endpoint supporting the flag:
`OpportunitiesList.tsx`, `PackageReviewScreen.tsx`, `RelationshipsPanel.tsx` (all three call
`/api/hidden-demand/opportunities`), and `HardToFillTargeting.tsx`
(`/api/hard-to-fill/targeting`). This is the deployed demo's **only** data source — synthetic
seed rows are the entire dataset, not a subset alongside real signals — so there is no
"seed data pollutes real data" tradeoff to weigh here, unlike S-18's original load-test
concern the flag was built for.

**Known gap, not silently worked around:** `backend/src/routes/analytics.ts` has no
`includeSeedData` opt-in at all — it hardcodes `WHERE source != 'seed-job-board'` directly in
its SQL (line 74), with no query-param branch to flip. `AnalyticsDashboard.tsx`'s fetch calls
were **not** changed, since appending the flag there would do nothing (the backend never reads
it) and adding an inert query param would misrepresent that anything was fixed. Practical
effect: the deployed demo's Analytics screen (time-to-hire, demand score) will keep excluding
the seeded opportunities and reporting on an effectively empty dataset, even though the
Opportunities board and hard-to-fill targeting now show the seed data correctly. If Ali's demo
script visits Analytics, this discrepancy will be visible — flagged here rather than
discovered live.

## What this rests on

That the deployed demo's dataset is 100% synthetic seed data (true today, per Angel's seed run
and decision 023/029's "synthetic data only" S-20 posture) — so unconditionally opting in on
every frontend call is safe and correct for this deployment, not a workaround being smuggled
past the flag's original purpose.

## What would make this wrong

**R5's real ingestion work removes the need for this entirely.** Once real market-signal data
flows in (R5, per `NEW-CO_2.MD`'s Greenhouse/Lever connector work), a mixed real+seed dataset
means unconditionally including seed rows is wrong again — this change should be reverted (or
made conditional on an explicit demo-mode flag) at that point, not left in permanently. Also:
if Ali's Phase 3 demo script covers the Analytics screen, the known gap above should be fixed
properly (a real `includeSeedData` query-param branch added to `analytics.ts`, mirroring
`hiddenDemand.ts`'s pattern) rather than left as a known limitation — not done here to keep this
hotfix narrowly scoped to what's actually broken (the empty Opportunities page), not expand
into an unrelated route's behavior under deadline pressure.
