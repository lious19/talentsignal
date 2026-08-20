# S-18 load-test harness

Repeatable concurrency validation for REQ-017 (p95 < 200ms normal / < 500ms peak; 1000
concurrent target). Methodology and rationale: `06_decisions/028-load-validation-concurrency-and-pool-sizing.md`.
Results doc (real numbers from an actual run): `05_presentations/S-18-load-results.md`.

## Why this is opt-in, not part of `npm test` / CI
This directory is outside `src/` (`tsconfig.json`'s `include` is `src/**/*.ts`, so `npm run
build` never sees it) and outside `tests/` (`vitest.config.ts`'s `include` is
`tests/**/*.test.ts`, and nothing here matches `*.test.ts`). `npm test` and any future CI
workflow (S-19) cannot pick this up structurally -- not by an env-var gate someone could forget,
the way the existing `RUN_TIMING_TESTS=1` latency tests need one.

## Prerequisites
1. The full stack is running: from the repo root, `docker compose up --build`.
2. The backend was started with `MARKET_SIGNAL_PROVIDER=seed` and a `SEED_SIGNAL_COUNT` set
   (e.g. `2000`) -- otherwise `/hidden-demand/analyze` and everything reading from it measures
   the 2-row `MockJobBoardProvider`, not real volume. The harness prints a warning if this isn't set.
3. `ADMIN_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` are set in the environment the harness itself runs
   in (the same values the backend booted with) -- the harness logs in ONCE as this account and
   shares the token across every scenario and tier. It never logs in per virtual user:
   `/auth/login` is rate-limited to 10 requests/15min per IP (`auth.ts`).

## Run it
```
cd backend
npm install
npm run load-test
```
One command, per the story's requirement. Prints a running summary table grouped by profile
(`read` / `bulkWrite` / `login`) and writes a timestamped JSON file to `results/`.

## What it measures, and how
- **Read/compute endpoints** (`health`, `/hidden-demand/opportunities`,
  `/client-matchmaking/match`, `/recommendation-engine/recommend`, `/hard-to-fill/targeting`) run
  a `1 -> 10 -> 50 -> 100 -> 250 -> 500` concurrency ladder, ~20s per tier.
- **`/hidden-demand/analyze`** runs its own `1 -> 5 -> 10` ladder, reported and interpreted
  separately -- it's a bulk upsert of the whole seed batch per call, not a bounded read, so a
  `statement_timeout` there is the AC-4-2 cap firing by design, not a throughput failure. See
  decision 028.
- **`/auth/login`** runs a single bounded-request-count scenario (not duration-based), and its
  numbers are read against decision 006 (bcrypt cost-12 can alone exceed 200ms; auth endpoints
  are a proposed, still-unconfirmed REQ-017 exception), not as a bare pass/fail.
- p50/p95/p99 are computed from autocannon's raw per-request `response` event timings, not its
  built-in percentile set (which reports p97_5, not p95) -- see `runTier.ts`'s comment.
- Between every tier, `run.ts`'s `waitForDrain()` polls `/api/health` until its own round trip is
  fast again (proof the connection pool has actually recovered from the previous tier's backlog,
  not a fixed guessed cooldown) before starting the next one -- see decision 028's implementation
  note for why a fixed cooldown wasn't reliable enough.

## Comparing the `pool.ts` connection-limit cliff (decision 028)
`db/pool.ts` defaults to 10 connections (unset `max`). To see the delta a larger pool buys, run
the harness twice:
1. Default: just `docker compose up` as normal, then `npm run load-test`.
2. Bumped: restart the backend with `DB_POOL_MAX=20` set, then `npm run load-test` again.

Both JSON outputs land in `results/`; the results doc reports both.

## Reproduce a specific past run
The exact command is always `npm run load-test` from `backend/`, with the environment variables
above set. `results/*.json` records the environment block (CPU/RAM/OS/Node version, provider
config, pool config) alongside every tier's numbers, so a re-run's shape can be compared
directly against a checked-in prior run.
