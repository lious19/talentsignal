# S-01 — Walking-skeleton monorepo on Docker Compose
**Status:** Complete · **Delivered:** 2026-07-22 (due Jul 21, one day late)
**Requirement:** REQ-018 · **Agent:** PlatformAgent

## What shipped
One command — `docker compose up` — starts three networked services: a React front end,
a Node/Express API, and PostgreSQL. The React tile makes a real request to Express, which
runs a real query against Postgres. The whole path is proven before any feature is built.

## Both acceptance scenarios pass

**Stack boots clean** ✅
Verified from a genuinely empty state (`docker compose down -v` → `up --build`).
Services sequence correctly: db → healthy → backend → healthy → frontend.
`001_init.sql` applied against an empty volume. `/health` returns
`{"status":"ok","db":"ok"}` — and the `db: ok` is a live query round-trip, not just a
process check.

**🛡 Structured logs at every boundary** ✅
Every request emits a single-line JSON log with correlation id, route, method, status,
and duration:

```json
{"level":30,"time":"2026-07-22T15:21:16.004Z","correlationId":"megan-demo-001",
 "route":"/health","method":"GET","statusCode":200,"durationMs":2.04,
 "msg":"request completed"}
```

An inbound `X-Correlation-Id` is honored rather than overwritten, and echoed back on the
response — so a caller can trace their own request through the logs.

## Decisions made
| # | Decision | Rationale |
|---|---|---|
| — | **TypeScript**, not JavaScript | DoD says "tsc clean." Retrofitting types across 20 stories costs far more than starting typed. **Pending Ali's confirmation.** |
| — | **Hand-rolled migration runner**, not an ORM | Keeps the schema in raw SQL. REQ-013 needs an append-only audit enforced by DB constraint later; nothing hidden behind a migration DSL. |
| — | **pino** for logging | Its job is structured JSON lines, which is exactly what the trust scenario tests. |
| 001 | **db host port 5433**, not 5432 | A native PostgreSQL 18 service already occupies `127.0.0.1:5432` on the dev machine. Container-to-container traffic is unaffected. |

## Two defects caught in review, before any code was written
1. **Startup ordering.** The first plan had no Postgres healthcheck. `depends_on` alone
   waits for a container to *start*, not to be *ready* — so a cold start would have raced
   the API against an unready database. Fixed with `pg_isready` healthcheck plus
   `depends_on: condition: service_healthy`.
2. **No tests.** The plan had none, which fails the definition of done. Added coverage for
   happy path, DB-down failure, and migration idempotency.

## One defect caught after
The logger listened only for `res.on("finish")`, which fires only on normal completion.
A client disconnecting mid-request produced **no log line at all** — the exact silence
structured logging exists to prevent. Fixed by also listening for `close` and using
`res.writableEnded` to distinguish a completed request from an aborted one, with a guard
so keep-alive connections don't double-log.

## What is deliberately not here
No auth, no domain model, no scoring, no styling. The UI is one line of plain text. That
is the point of a walking skeleton: prove every layer talks before building anything on
top of them.

## Known limitations, stated honestly
- The abort test uses a fake `EventEmitter` rather than a real TCP disconnect. It proves
  the middleware logic; it does not prove Node's socket behavior.
- CORS is wide open (`*`) for local dev. Must be tightened before S-20 deploy.
- Frontend/backend routing is a Vite dev proxy. Production routing is an S-20 problem.

## Next
S-02 — secure authentication (register/login, JWT). Spec at `00_scope/stories/S-02.md`.
Open question for Ali: JWT lifetime. Defaulting to 15 minutes with a refresh token.
