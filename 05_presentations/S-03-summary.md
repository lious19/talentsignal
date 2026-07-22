# S-03 — First vertical slice: one signal becomes one opportunity
**Status:** Complete · **Delivered:** 2026-07-22 (due Jul 23 — one day early)
**Requirements:** REQ-019, REQ-001 · **Agent:** SignalAgent
**⚠️ Decision 007 (confidence weights) is PROPOSED, pending Ali's approval.**

## What shipped
A mocked job-board signal flows through a provider adapter, gets scored by a transparent
heuristic, is upserted into PostgreSQL, and renders in a React list with its confidence,
the reasons behind it, and its originating source.

## Both acceptance scenarios pass

**Signal to opportunity end to end** ✅
`POST /api/hidden-demand/analyze` → mocked provider → scored → stored → rendered.
Verified live against the Docker stack: two analyze calls produced exactly one row
(`SELECT count(*) FROM opportunities` → 1), confidence 0.936, matching the hand-computed
formula.

**🛡 Confidence and source are always shown** ✅
Renders as: `Acme Corp — 94% confidence — open 24 days, reposted role, no salary range ·
source: mock-job-board`. The confidence badge and source tag are destructured from the
same object in the same JSX block, so there is no code path that renders a bare number.

## Confidence score — PROPOSED, not approved
Ali has not supplied the factors or weights. Rather than miss the deadline or invent
numbers silently, the model is a transparent weighted sum with every constant in one
exported config object:

| Factor | Weight | Plain-English reason |
|---|---|---|
| Base | 0.20 | A real posting existing is itself weak evidence of demand. Without this, a brand-new posting scores 0.0, which is indefensible. |
| Reposted role | 0.32 | Re-posting the same title means they tried and failed to fill it once. |
| Days open (capped at 30) | 0.32 | The longer it sits, the harder it's proving to fill internally — exactly when an agency's pitch lands. Capped so a 200-day role doesn't dominate. |
| No salary range | 0.16 | Correlates with less structured hiring. Weaker proxy, hence the lower weight. |

Maximum = 1.00. **Ali's answer is a one-line edit to `confidenceConfig.ts`** — nothing else
in the codebase reads raw weights.

## Architecture
- **Provider adapter seam.** `MarketSignalProvider` is an interface; `MockJobBoardProvider`
  implements it. The route receives the provider as a constructor argument, so a real job
  board needs zero changes to the route, the scoring function, or the tests — only the one
  wiring line in `server.ts`.
- **Explicit timeout** (5s) via `Promise.race`, per CLAUDE.md rule 8. The interface itself
  takes `timeoutMs`, so every future implementation is contractually forced to respect one.
- **Idempotency** via `UNIQUE (source, external_signal_id)` plus `ON CONFLICT DO UPDATE`.
  Re-analyzing refreshes the score in place rather than duplicating or silently ignoring.
  Tradeoff: no score history. Revisit at S-07 if that's wanted.

## Fixed along the way
- **`/api` mount deviation.** Express served routes at root; the acceptance criteria name
  `/api/auth/login` and `/api/hidden-demand/analyze`. Those paths only worked in a browser
  because the Vite proxy stripped `/api` — and would have broken at S-20, where no Vite dev
  server exists. Routers now mount under `/api`, the proxy rewrite is gone, and the compose
  healthcheck points at `/api/health`.
- **`requireAuth` was dead code.** Written in S-02, applied nowhere. Now enforced on both
  hidden-demand routes, with the 401 path tested. This is authentication, not RBAC — S-14
  is untouched.
- **S-02 debt: register/login screens.** S-02's build note called for them and they were
  never built, which is why a token had to be hand-placed in localStorage. Now built, with
  register → auto-login → opportunities → logout verified live in a browser.
- **Missing DOM cleanup** in `setupTests.ts` — tests rendering identical markup collided.
  Fixed centrally rather than per-file.

## Tests
42 backend (3 skipped by design), 11 frontend. tsc clean both sides. Coverage includes the
401 path, provider failure (502), provider timeout (504) with **no row written**, and
idempotency.

## Known limitations
- **Confidence weights are unapproved.** Decision 007, marked PROPOSED.
- JWT lives in localStorage — XSS-readable. Decision 008 states the tradeoff; httpOnly
  cookie deferred to S-20 because the correct flags depend on a topology S-20 hasn't decided.
- The database holds accumulated test users and opportunities. Seed data is S-19; run
  `docker compose down -v` before any demo.
- No deployed demo until S-20, so the DoD's final clause is met against the local stack only.

## Next
R0 is complete. S-04 (Hidden Demand Analysis service) due Mon Jul 27.
