# 029 — E2E journey scope, seed shape, and CI gate scope

**Date:** 2026-08-21
**Story:** S-19
**Requirement:** REQ-018 (CI/quality gate) — confirm exact REQ with Ali; S-19.md itself is
synthesized, not pulled verbatim from Basecamp
**Decided by:** Megan (PROPOSED — pending Ali)

## The question

S-19's Gherkin names two journeys and a green-gate requirement in general terms. Turning that
into actual code required five concrete calls that are business/process decisions, not
mechanical implementation: which journeys count as "E2E-critical," what "lint" means for a repo
with zero ESLint config, whether to finally enforce S-18's deferred perf threshold now that CI
exists, what the seed dataset should contain, and — discovered only while building this —
whether setting `DATABASE_URL` in CI is itself a decision worth naming (it is: it silently
promotes every currently-self-skipping integration/append-only/migrate test into a required
blocking gate for the first time, with zero code changes to those files).

## Options considered

**E2E journeys:**
1. One exhaustive journey touching every router — thorough, but conflates test failures
   (any router's regression fails the same test) and duplicates coverage every router already
   has as isolated integration tests.
2. The two journeys named verbatim in the story's own Gherkin — chosen.
3. A journey per router pairing — closer to integration-test duplication than a genuine
   cross-endpoint proof.

**Lint:**
1. Stand up ESLint today — real linting, but zero infra exists anywhere in the repo; adding it
   same-day risks unrelated fallout across ~75 test files this close to the deadline.
2. `tsc --noEmit` over `src/` + `tests/` via a new `tsconfig.ci.json` — chosen. Not equivalent to
   ESLint (no style/pattern rules), but closes a real, concrete gap: `tsconfig.json` excludes
   `tests/`, so `npm run build` today never type-checks any test file at all.
3. No lint gate — rejected; the story's acceptance criteria explicitly require one.

**Perf threshold in CI:**
1. Pick up 028's deferred hard latency assertion now that CI exists — the natural next step, but
   risks flakiness on a shared runner with no CI perf budget agreed with Ali yet, this close to
   the deadline.
2. Defer again — chosen. `*.latency.integration.test.ts` stays diagnostic-only
   (`RUN_TIMING_TESTS=1`, never set by CI).

**Seed dataset:**
1. Large/randomized — more realistic, but slower CI and non-deterministic, working against the
   story's own "identically every run" acceptance criterion.
2. Small, fixed, reused where possible — chosen.

## What we chose, and why

**E2E-critical journeys — the two named in the story's Gherkin, and only those:**
- **Journey A** (`hiddenDemandJourney.e2e.test.ts`): register → login → hidden-demand analyze →
  opportunities → hard-to-fill targeting. Proves a signal written by one endpoint is the exact
  row a different endpoint reads back through real Postgres — no existing integration test
  proves that continuity, since each one drives a single router against hand-built fixtures.
- **Journey B** (`matchmakingToReleaseJourney.e2e.test.ts`): client/job/candidate creation →
  client-matchmaking → recommendation-engine (+feedback) → opportunity-package draft → release.
  Proves the full human-release workflow holds together end-to-end, including that feedback
  persists across separate calls and that the draft→release trust guarantees hold under real
  HTTP + Postgres, not a fake pool.

  Journey B uses `adminAuthHeader()` throughout, not a real login. This is deliberate, not an
  oversight: self-registration only ever produces role `sales` (decision 003 — no self-service
  path to `recruiter`/`admin`), but Journey B's routes need `PII_VISIBLE_ROLES`
  (`admin`+`recruiter`) for clients/candidates and `recommendation-engine`. `admin` is the only
  role that clears every gate the journey touches, so it's the only role that lets one journey
  exercise the whole path without artificial user-switching machinery. Journey A does use a real
  register→login round trip, since its routes (`admin`+`sales`) are reachable by
  self-registration alone.

  Every other router (`clients`, `candidates`, `jobOpenings` in isolation, `crm`, `analytics`,
  `pii`, etc.) already has direct integration coverage and doesn't need a second cross-endpoint
  proof — adding more journeys would duplicate what's already tested, not close a real gap.

**Setting `DATABASE_URL` in CI is itself the headline behavior change, worth naming explicitly.**
Every file using the `describeIfDb` self-skip pattern (`DATABASE_URL ? describe : describe.skip`)
— every `*.integration.test.ts`, every `*.appendOnly.integration.test.ts`, `migrate.test.ts` —
has been silently skipped in every CI-equivalent run until this story, because nothing before
S-19 ever set `DATABASE_URL` outside a developer's own machine. S-19's CI workflow turns all of
them from "exists but never enforced" into "required, blocking, every push" with zero code
changes to those files. That's a real change to what "green" has meant for this whole project,
not an incidental side effect of adding new files — see "Implementation note" below for what it
immediately surfaced.

**Lint = `tsc -p tsconfig.ci.json --noEmit`.** Chosen over standing up ESLint today given zero
ESLint infra exists anywhere in the repo. Real ESLint is a named fast-follow, not dropped —
tracked as an open item below.

**Perf threshold: deferred again, not picked up.** Same flakiness-on-shared-runner reasoning as
028, now reinforced by a real data point from this story's own build (see "Implementation note"
below on a transient flake observed under real parallel Postgres load).

**Seed dataset — small and deterministic:** `seedDemo.ts` composes the existing
`seedAnalyticsDemo.ts` (~26 clients with pipeline history and job openings, already
skip-existing idempotent) + 6 fixed candidates (prefixed `"Seed Demo Candidate"`, same
skip-existing discipline) + a 9-signal hard-to-fill batch run through the real
`upsertBatch`/scorer (not a hand-rolled guessed score) via `SeedJobBoardProvider(9)`.
Idempotency is free from `upsertBatch`'s existing `ON CONFLICT (source, external_signal_id) DO
UPDATE`. One seed command, three consumers: the CLI (`npm run seed:demo`), a dedicated
`seedDemo.idempotent.integration.test.ts` that calls it twice and asserts identical row counts
and identical opportunity scores the second time, and `hiddenDemandJourney.e2e.test.ts`'s
`beforeAll` (baseline the journey's own live `analyze` call adds on top of).

## Implementation note — two existing integration tests needed a schema-drift fix

Running the full suite against real Postgres for the first time in CI conditions (this story is
what actually sets `DATABASE_URL`) surfaced that two hand-written `INSERT INTO opportunities`
statements predate migrations 013 and 014, which added `hard_to_fill_score` /
`hard_to_fill_reasons` / `hard_to_fill_factors` / `hard_to_fill_version` and `title` as `NOT NULL`
columns. Those inserts never got updated when the migrations landed, because nothing had run them
against a real database in a required way since — they'd been silently skipping in every
CI-equivalent run.

Affected: `backend/tests/opportunityPackage.appendOnly.integration.test.ts` and
`backend/tests/analytics.pii.integration.test.ts`. Fix: added the five missing columns with
neutral placeholder values (`0`, `ARRAY[]::text[]`, `'[]'::jsonb`, `'v1'`, `'Engineer'`) to each
`INSERT`. This is purely a schema-compliance fix — **no assertion in either test changed.**
`opportunityPackage.appendOnly.integration.test.ts` still proves the exact same thing it always
did (a real Postgres trigger rejects UPDATE/DELETE against a release-audit row, leaving it
byte-for-byte unchanged); `analytics.pii.integration.test.ts` still proves the exact same thing
(the aggregate-only analytics response contains none of the registry's PII field names, checked
against a real `pii_fields` table). Both were previously *unable to run at all under
`DATABASE_URL`* — the insert would have failed with a NOT NULL violation before either test's
actual assertion was ever reached — so this fix doesn't weaken rigor, it's what makes the
existing rigor reachable for the first time. Verified: full suite green with `DATABASE_URL` set
(295/295 tests, 69/73 files, 4 skipped — the diagnostic latency tests), and unchanged
skip-by-default behavior confirmed with `DATABASE_URL` unset (265/299, matching S-18's own
last-known baseline plus this story's new files).

This is exactly the kind of gap S-19's CI existing to catch was supposed to close — a real,
pre-existing test-fixture bug that nothing before this story would ever have caught, because
nothing before this story made these tests mandatory.

## Implementation note — a transient parallel-run flake, not a regression

During this story's build, one full-suite run showed a single suite-level error in
`pii.registryCoverage.test.ts` that did not reproduce on a standalone re-run of that file, and did
not reproduce on an immediate full-suite retry (69/69 files, 295/295 tests green). The most likely
cause is Postgres connection contention from vitest running many parallel integration test files'
own scoped pools simultaneously against one shared local container — not a code defect. No change
was made to `vitest.config.ts`'s parallelism settings (out of this story's scope, and risk of
destabilizing behavior elsewhere). This is treated as a supporting data point for the
perf-threshold deferral above: the same shared-runner contention that could produce a flaky
latency assertion in CI already produces occasional flakiness today, on a single laptop.

## What this rests on

That the two journeys named in the Gherkin are actually the highest-value cross-endpoint seams —
i.e., that every other router's existing integration coverage is sufficient on its own and
doesn't also need a live-HTTP cross-endpoint proof.

## What would make this wrong

- If Ali's real S-19 Basecamp ticket (once linked) names different or additional critical
  journeys than the kickoff doc this was synthesized from.
- If a real ESLint pass, once stood up, catches something `tsc --noEmit` structurally can't (e.g.
  a footgun pattern, not a type error) — that's the expected outcome of the lint choice above,
  not a sign it was wrong, but worth tracking as the reason ESLint stays a named fast-follow.
- If CI's shared runner turns out to have enough headroom that a perf-threshold assertion would
  in fact be stable — this decision should be revisited once real Actions run data exists (it
  doesn't yet; no git remote is configured — see `05_presentations/S-19-ci-trust-red-proof.md`).
- If the seed dataset's size ever needs to grow for a future story's demo needs, the same
  skip-existing/`upsertBatch`-idempotency pattern should extend directly rather than being
  redesigned.
