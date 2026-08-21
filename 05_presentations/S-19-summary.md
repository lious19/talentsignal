# S-19 — End-to-end tests, seed data, and CI
**Status:** Complete · **Delivered:** 2026-08-21
**Requirements:** REQ-018 (CI/quality gate) — confirm exact REQ with Ali · **Agent:** PlatformAgent
**⚠ Story provenance:** `00_scope/stories/S-19.md` was synthesized from
`05_presentations/CLAUDE-CODE-KICKOFF-S18-S19.md`, not pulled verbatim from Basecamp — flagged for
Ali to reconcile against his real S-19 ticket.

## What shipped
Two end-to-end journeys (`backend/tests/e2e/`) driving real HTTP + a freshly migrated Postgres
schema through the actual `createApp()` stack, no mocks: **Journey A**
(`hiddenDemandJourney.e2e.test.ts`) registers a real user, logs in, analyzes signals, and reads
the resulting opportunities back through two different endpoints, proving a row one endpoint
writes is the exact row another endpoint reads through real Postgres. **Journey B**
(`matchmakingToReleaseJourney.e2e.test.ts`) runs client/candidate/job creation through matchmaking,
recommendation feedback, and the full opportunity-package draft→release workflow, including
proving the release-audit table gets exactly one row and a second release attempt 409s with the
original fields unchanged.

A deterministic seed command (`backend/src/db/seedDemo.ts`, `npm run seed:demo`) composes the
existing `seedAnalyticsDemo.ts` (~26 clients) with 6 fixed candidates and a 9-signal hard-to-fill
batch run through the real scorer — idempotent via `upsertBatch`'s existing `ON CONFLICT DO
UPDATE`, proven by a dedicated test (`seedDemo.idempotent.integration.test.ts`) that runs it twice
and asserts identical rows the second time. One seed, three consumers: the CLI, that test, and
Journey A's baseline.

A GitHub Actions workflow (`.github/workflows/ci.yml`) with two jobs. `backend`: a
`postgres:16-alpine` service (matching `docker-compose.yml`), `npm test` (unit + every
`describeIfDb`-gated integration/E2E/migration test — one invocation, since `DATABASE_URL` being
set is what un-skips them, zero code changes needed), `npm run build`, and a new
`npm run typecheck:tests` (`tsc -p tsconfig.ci.json --noEmit`) that closes a real gap:
`tsconfig.json` excludes `tests/`, so `npm run build` alone never type-checked any test file.
`frontend`: `npm test` + `npm run build`, included for real coverage the repo didn't have, not
because the story's Gherkin required it.

## Both acceptance scenarios pass
**E2E over the real stack, deterministic seed, CI green gate** ✅ — both journeys pass against
real Postgres + HTTP (295/295 tests green with `DATABASE_URL` set, 69/73 files, 4 skipped —
diagnostic latency tests requiring `RUN_TIMING_TESTS=1`, deliberately not set by CI); `npm run
build` and `npm run typecheck:tests` both clean; default `npm test` (no `DATABASE_URL`) still
self-skips exactly as before (265/299 — the story added new self-skipping files, so more tests
skip by default now, same mechanism as always). Frontend: 37/37 tests, clean build.

**🛡 TRUST — the gate proves the guardrails, not just happy paths** ✅ — see
`S-19-ci-trust-red-proof.md` for the full writeup. A real one-line regression (the draft handler
inserting `status: 'released'` instead of `'draft'`) was introduced into
`opportunityPackage.ts`, CI's exact `npm test` command was run against real Postgres, and it went
red: 2 files failed, both tracing directly to the break — Journey B's own TRUST assertion
(`GET /opportunity-packages` must show a fresh draft still `"draft"`) and the append-only audit
test (whose precondition — a package starting in `draft` — no longer existed). Reverted; `git diff
--stat` showed zero remaining changes; re-ran the identical command; green again (295/295).

## Kept honest
- **No live GitHub Actions run exists yet.** There is no git remote configured for this repo
  (`git remote -v` returns empty — a REPO to-do, tracked ahead of S-20, not this story's job to
  fix). The workflow YAML is written and syntax-validated (`js-yaml` parse), every step's command
  has been run locally with an equivalent `DATABASE_URL`/`JWT_SECRET` and behaves as the workflow
  expects, and the trust gate has been red-proven locally with CI's exact command — but a real
  green (or red) Actions run against GitHub itself is still pending the repo existing there.
- **Setting `DATABASE_URL` in CI is a real behavior change, named explicitly in decision 029, not
  buried as an implementation detail.** Every `describeIfDb`-gated integration/append-only/migrate
  test in the repo has been silently skipping in every CI-equivalent run until this story — S-19's
  workflow is what makes all of them required and blocking for the first time.
- **Running the full suite against real Postgres surfaced two pre-existing test-fixture bugs, not
  introduced by this story.** `opportunityPackage.appendOnly.integration.test.ts` and
  `analytics.pii.integration.test.ts` both hand-write `INSERT INTO opportunities` statements that
  predate migrations 013/014's `NOT NULL` columns. Fixed by adding the missing columns with
  neutral placeholder values — **no assertion in either test was weakened**, both prove exactly
  what they always proved, they just couldn't run at all under `DATABASE_URL` before this fix.
  Full detail and the "why this isn't scope creep" reasoning is in decision 029.
- **Journey B uses `adminAuthHeader()` throughout, not a real login**, because self-registration
  only ever produces role `sales` (decision 003) and admin is the only role that clears every
  RBAC gate the journey touches. Documented as deliberate in decision 029, not an oversight.
- **A transient parallel-run flake was observed and investigated, not silently ignored.** One full
  run showed a suite-level error in `pii.registryCoverage.test.ts` that didn't reproduce standalone
  or on immediate retry — diagnosed as Postgres connection contention from many parallel scoped
  pools on one shared local container, not a code defect. Used as a supporting data point for
  keeping perf-threshold assertions out of CI (same shared-runner-contention risk), not acted on
  by touching `vitest.config.ts`'s parallelism (out of scope).
- **Lint = `tsc --noEmit`, not real ESLint** — zero ESLint infra exists anywhere in the repo;
  standing it up same-day risked unrelated fallout across ~75 test files. Logged as a named
  fast-follow in decision 029, not dropped.
- **The story's own acceptance criteria are provisional.** `S-19.md` is marked synthesized pending
  Ali's real Basecamp ticket; this summary reports against the synthesized criteria.

## Tests
295 backend tests pass with `DATABASE_URL` set (69/73 files; 4 skipped — diagnostic
`RUN_TIMING_TESTS=1`-gated latency tests, unchanged from before this story), 265/299 pass with it
unset (default `npm test`, confirming no regression to existing skip-by-default behavior). 37/37
frontend tests pass. `npm run build` and `npm run typecheck:tests` both clean. New:
`hiddenDemandJourney.e2e.test.ts`, `matchmakingToReleaseJourney.e2e.test.ts`,
`seedDemo.idempotent.integration.test.ts`. Fixed (schema-drift, not new coverage):
`opportunityPackage.appendOnly.integration.test.ts`, `analytics.pii.integration.test.ts`.

## Next
S-20 (deploy, due today 2026-08-21) — not started, per this story's explicit instruction not to
begin it. The REPO to-do (push this repo to GitHub, giving CI an actual remote to run against) is
a natural prerequisite worth doing early in S-20, since it's what turns this story's local
red-proof into a real Actions run. Real ESLint remains a named fast-follow (decision 029). The
perf-threshold CI-guard stays deferred a second time, now with a supporting flakiness data point,
awaiting a CI perf budget from Ali.
