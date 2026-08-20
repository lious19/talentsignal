# S-18 — Performance and load validation
**Status:** Complete · **Delivered:** 2026-08-20
**Requirements:** REQ-017 · **Agent:** PlatformAgent
**⚠ Story provenance:** `00_scope/stories/S-18.md` was synthesized from the kickoff doc, not
pulled verbatim from Basecamp — flagged for Ali to reconcile against his real S-18 ticket.

## What shipped
A repeatable, one-command load-test harness (`backend/scripts/load-test/`, `npm run load-test`)
that drives seven key endpoints (health, login, hidden-demand analyze + opportunities,
client-matchmaking, recommendation-engine, hard-to-fill targeting) under a documented concurrency
ladder against the real Docker stack, and reports p50/p95/p99 against REQ-017. It ran twice — once
at today's default DB connection pool (10), once with an opt-in `DB_POOL_MAX=20` — to isolate
pool contention from other bottlenecks. Real numbers from both runs are in
`05_presentations/S-18-load-results.md`. Along the way, two production bugs the harness exposed
were fixed: `/hard-to-fill/targeting` couldn't see seed data at all (no opt-in, unlike
`/opportunities`), and seeded opportunity titles could never mathematically clear the
hard-to-fill score threshold.

## Both acceptance scenarios pass
**Key endpoints measured under concurrency, p95/p99 reported against REQ-017** ✅ — see the
per-endpoint tables in the results doc. `/health`, `/recommend`, and `/match` scale as expected
(compute- and pool-bound); `/opportunities` and `/targeting` do not scale with more pool because
they're bound by per-request cost, not connection count — reported as a real finding, not hidden.

**🛡 TRUST — honest measurement** ✅ — every number in the results doc came from an actual run
against the real stack (`run-default-pool.log`, `run-pool20.log`, and their timestamped JSON
outputs, checked in as evidence). Nothing was estimated and reported as measured. Where a tier
produced `NaN`/all-errors (the two heavy read endpoints at higher concurrency), that's reported
as what happened, with the mechanism explained (a harness drain-window limit, not proof the
endpoint serves zero requests) — not smoothed over or omitted.

## Kept honest
- **1000 concurrent is extrapolated, not demonstrated.** Per decision 028, 500 concurrent on one
  laptop container was the ceiling — high enough to expose every real bottleneck (pool
  contention on `/match`/`/recommend`; per-request cost on `/opportunities`/`/targeting`), and
  pushing further would measure the laptop, not the code. The results doc reasons in plain
  English about what infra change would close the remaining gap for the pool-bound endpoints,
  and states plainly that the two cost-bound endpoints won't reach it through infra alone.
- **`/opportunities` and `/targeting` don't scale yet, and that's reported, not fixed here.**
  Their bottleneck (unpaginated full-table read; an O(opportunities×candidates) join done in
  application code instead of SQL) is a real structural finding. Fixing it is flagged as future
  work, explicitly out of S-18's scope — S-18 measures and surfaces, it doesn't rewrite the
  routes it's testing.
- **Login's ~200–475ms p95 is read against decision 006's bcrypt-cost tradeoff**, not treated as
  a fresh regression — that decision's proposed REQ-017 exception for auth endpoints is still
  open, not silently resolved by this story.
- **`/hidden-demand/analyze`'s `statement_timeout` hits at `c=5`–`10` are AC-4-2's cap firing by
  design**, kept on its own ladder and never averaged into the read-endpoint percentiles.
- **The story's own acceptance criteria are provisional.** `S-18.md` is marked synthesized
  pending Ali's real Basecamp ticket; this summary reports against the synthesized criteria, not
  a final signed-off spec.

## Tests
265 backend tests pass (31 skipped, unrelated), tsc clean. Added one new test covering the
`/hard-to-fill/targeting?includeSeedData=true` opt-in this story's fix introduced, and fixed a
gap in the existing `fakeTargetingPool` test helper that would have silently passed that test
regardless of whether the opt-in actually worked (it wasn't distinguishing the two SQL branches
before this story touched it). The load-test harness itself is intentionally outside `npm test`
and any CI gate — it lives outside both `tsconfig.json`'s and `vitest.config.ts`'s `include`
globs structurally, not by an env-var convention someone could forget.

## Next
S-19 — Ali has said to hold; do not start without his go-ahead. When it resumes: CI-guard scope
for this harness (deferred here per decision 028), and the `/opportunities`/`/targeting`
pagination and query-pushdown work this story flagged.
