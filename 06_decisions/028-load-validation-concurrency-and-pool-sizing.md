# 028 — Load-validation concurrency ladder, bulk-write split, and pool sizing

**Date:** 2026-08-19
**Story:** S-18
**Requirement:** REQ-017
**Decided by:** Megan (PROPOSED — pending Ali)

## The question
REQ-017 says "1000 concurrent target." `scope.md` flags this as unresolved: is that
*demonstrated* under real load, or *estimated*? And once a harness exists, several
methodology choices ride on it: what concurrency ladder to actually run, whether
`/hidden-demand/analyze` belongs on that same ladder, whether `pool.ts`'s unset connection
limit gets addressed, and how seed data's visibility gaps get fixed so the numbers mean
anything.

## Options considered
1. **Fake a 1000-VU run** against a single Docker container on one laptop. Rejected — the
   numbers would not reflect real behavior, and reporting them as "1000 concurrent, validated"
   would be exactly the fabricated/cherry-picked claim the trust scenario forbids.
2. **Skip load testing, mark REQ-017 as "estimated only," no evidence.** Rejected — the
   project's own `GAME_PLAN.md` explicitly says to build a harness and measure what's
   reachable, and this project's default is heuristic-and-evidence over guesswork.
3. **Measured ramp on the real Docker stack, honest extrapolation to 1000.** Chosen.

## What we chose, and why

**Ladder for read/compute endpoints (PROPOSED):** `1 → 10 → 50 → 100 → 250 → 500` concurrent
connections, each held ~8 seconds (originally proposed at 20s; reduced during real execution
because this measurement environment — a sandboxed VM — could not reliably keep an unattended
process alive across the multi-minute session/wakeup boundaries a 20s-per-tier run required;
Docker's own daemon independently stopped mid-run twice at those boundaries. 8s still yields
hundreds-to-thousands of requests per tier at every concurrency level actually run, per the
results doc's `requests` column — a disclosed environment constraint, not a silent shortcut).
Applies to: `/health`, `/hidden-demand/opportunities` (GET), `/client-matchmaking/match`,
`/recommendation-engine/recommend`, `/hard-to-fill/targeting` (GET). 500 is the ceiling, not
1000, because it's high enough to expose the real structural bottleneck (see below) well below
500, and pushing a single-container laptop setup further stops teaching us anything new about
the code — it starts measuring the laptop instead. The results doc extrapolates to 1000 in plain
English — where p95 crosses 200/500ms, where the error rate stops being ~0, and what
infrastructure change (Postgres `max_connections`, `pool.ts`'s `max`, horizontal backend
replicas) would plausibly close the remaining gap — rather than claiming to have proven it at 1000.

**`/hidden-demand/analyze` is split onto its own ladder, `1 → 5 → 10` (PROPOSED).** It is not a
bounded read: every call is a single `unnest()` batch **upsert** of the whole signal set (up to
`SEED_SIGNAL_COUNT` rows) in one statement. At concurrency, N simultaneous multi-thousand-row
upserts compete for the same connection pool, and `pool.ts`'s `statement_timeout: 5000` will
fire under contention well before the 200/500ms targets even become relevant. That is **AC-4-2's
cap working as designed**, not a throughput failure of the harness or the endpoint. Mixing it
into the 1→500 read ladder would make the whole run look like it "collapses at 50" when what's
actually happening is one bulk-write endpoint hitting its own statement cap — so it is reported
and interpreted in its own section, never averaged into or compared against the read-endpoint
percentiles.

**`pool.ts`'s unset `max` (defaults to 10) is addressed, not ignored.** Every load-tested
endpoint except `/health` runs at least one `pool.query()`. Past roughly 10 concurrent in-flight
DB-touching requests, further requests queue inside the pool and then fail outright at
`connectionTimeoutMillis` (5000ms) rather than just running slow. Expect a cliff well under 500
on the *first* run at today's implicit default — that is a legitimate finding about the config
that is actually deployed today, not a bug in the harness. Plan: run the read-ladder twice — once
at today's default (characterizes what's actually deployed), once with a new, additive,
opt-in `DB_POOL_MAX` env var set higher, to show the delta a one-line config change buys.
**Proposed value for the comparison run: 20** — 2x today's default, comfortably under Postgres
16's own default `max_connections` (100), leaving headroom for migrations, health checks, and
admin bootstrap. `pool.ts`'s change itself is additive (`undefined` still preserves today's real
behavior unless `DB_POOL_MAX` is explicitly set) — but the *value* used for the comparison run is
a resource-tuning call, marked PROPOSED here, not finalized silently.

**Seed-data visibility, fixed with two small additive changes, not a route rewrite.** Confirmed
by reading route source directly (not assumed):
- `GET /hidden-demand/opportunities` already supports `?includeSeedData=true` (added in S-04).
  The harness must pass it, or it measures ~2 mock rows instead of real volume.
- `GET /hard-to-fill/targeting` (`hardToFillTargeting.ts:76`) hardcodes
  `AND source != 'seed-job-board'` with **no opt-in at all** — confirmed there is currently no
  way to see seed rows there without a code change.
- Worse: even with visibility fixed, `SeedJobBoardProvider`'s titles are the literal string
  `"Seeded Role"` for every generated row. `hardToFillScore.ts`'s `roleScarcity` factor — weight
  **0.6** of 1.0 — only fires on a case-insensitive substring match against
  `HARD_TO_FILL_CONFIG.roleKeywords` ("data analyst", "ai architect", "data scientist", …).
  "seeded role" matches none of them. Without it, the maximum reachable score is
  `daysOpen(0.2) + repostedRole(0.2) = 0.4`, below the `0.5` `hardToFillThreshold` **by
  construction** (the config's own comment confirms the threshold was deliberately set above
  what the two reinforcers can reach alone). So every seeded opportunity is mathematically
  incapable of ever appearing in targeting, independent of the source filter.
- **Chosen fix — option (b), plus the title fix option (3) also flagged, both together:**
  1. `hardToFillTargeting.ts` gets the identical `?includeSeedData=true` opt-in
     `/hidden-demand/opportunities` already has — same query-param name, same
     default-excluded behavior unless explicitly opted in. Chosen over standing up a wholly
     separate ad-hoc fixture-insert path because it mirrors an existing, already-reviewed
     pattern exactly, rather than introducing a second way to seed the same table.
  2. `seedJobBoardProvider.ts` varies titles: a fraction of generated rows (proposed: every 3rd
     row) cycle through `HARD_TO_FILL_CONFIG.roleKeywords` (e.g. "Data Scientist", "AI
     Engineer") instead of the constant "Seeded Role" string; the rest keep the generic title.
     Confirmed safe against the existing `hiddenDemand.latency.integration.test.ts`, which
     asserts only on `durationMs`, never on title content.
  Both changes are additive and opt-in/backward-compatible (default caller behavior for
  `/targeting` without the new param is unchanged; existing tests are unaffected by the title
  variation), but they are real production-code edits, called out explicitly here rather than
  folded silently into load-test scaffolding.

**CI-guard scope (PROPOSED):** defer an *enforced* threshold-assertion test to S-19, once CI
exists. S-18 ships a manual, opt-in harness only — consistent with the existing
`*.latency.integration.test.ts` precedent, which is also non-blocking.

**Login is interpreted against decision 006, not bare REQ-017.** Decision 006 already flagged
that bcrypt cost 12 (~250–300ms/hash, chosen deliberately for its security property, not
incidental) can alone exceed REQ-017's 200ms p95 target on `/auth/login`, and proposed auth
endpoints as an intentional, documented exception to REQ-017 — still unconfirmed by Ali. This
story's login results are reported against that framing: a login p95 in the 250–300ms range is
the expected shape given cost-12 bcrypt, not a regression, and is presented alongside a
restatement that decision 006's exception is still open, not silently assumed resolved by S-18.

**`SEED_SIGNAL_COUNT` for the load-test environment (PROPOSED): 2000** — meaningfully larger
than the seed provider's own default (500) without being an outlier next to the existing latency
tests' 5,000–10,000-row fixtures.

## Implementation note — tier-to-tier drain (found during real runs, iterated twice)
The first full harness run showed errors and `NaN` latencies appearing even at concurrency=1,
right at scenario boundaries — not a server-capacity finding, a harness gap: a saturated tier's
backlog of pool-queued requests was still draining when the next tier started immediately after,
contaminating its numbers. First attempt: a fixed 8-second cooldown between tiers, reasoned from
`connectionTimeoutMillis` (5000ms) — this was NOT enough after a truly saturated c=500 tier
(hundreds of queued requests, only ~10 servable at a time, meaning real drain time scales with
backlog depth, not with one request's timeout). Second, working fix: `waitForDrain()` in `run.ts`
polls `/api/health` (itself one `pool.query()` away from the same pool) between every tier until
ITS OWN round trip is fast again (<50ms) — direct evidence the pool has actually recovered,
capped at 10s (also reduced from an originally-proposed 60s, same environment-time-budget
reason as the 8s tier duration above) with a printed warning if it never does. Documented here because it changed the
reported numbers meaningfully across the three attempts, and a reader comparing runs should know why.

## Implementation note (not a judgment call, just plumbing)
`docker-compose.yml`'s backend service didn't pass `MARKET_SIGNAL_PROVIDER`, `SEED_SIGNAL_COUNT`,
or `DB_POOL_MAX` through to the container at all — setting them in `.env` alone would silently
do nothing. Added all three as optional, unset-by-default passthroughs (`${VAR:-}`), so normal
`docker compose up` behavior is unchanged and the load-test environment variables this decision
relies on actually reach the running backend.

## What this rests on
That a single-container Docker Compose stack on one laptop is a fair proxy for *relative and
structural* findings (where does the platform degrade, and why) — it is explicitly **not** a
fair proxy for absolute throughput at production scale. The 1000-concurrent extrapolation is
reasoning from measured structure, not a claim to have run 1000 concurrent users.

## What would make this wrong
- If Ali specifies a firm concurrency number he wants literally demonstrated (not extrapolated),
  this decision's ladder and its "extrapolate honestly" posture both need to change.
- If bumping `pool.ts`'s `max` to 20 causes Postgres connection exhaustion in practice (unlikely
  given the 100-connection default, but not verified until the real run), that becomes a new
  finding folded back into this doc, not papered over.
- If Ali's real S-18 Basecamp ticket (once captured) specifies different endpoints, thresholds,
  or a different concurrency posture than the kickoff doc this was synthesized from, this
  decision is revisited alongside `S-18.md`'s reconciliation.
