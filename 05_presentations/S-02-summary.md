# S-02 — Secure authentication (register / login, JWT)
**Status:** Complete · **Delivered:** 2026-07-22 (due Jul 22, on time)
**Requirement:** REQ-010 · **Agent:** IdentityAgent

## What shipped
Register and login endpoints backed by a `users` table. Login returns a signed JWT
carrying the user's id and role. Passwords are bcrypt-hashed and never appear in logs.

## Both acceptance scenarios pass

**Login issues a token** ✅
`POST /api/auth/login` with valid credentials returns a JWT whose decoded payload
carries the user id and role, with an expiry matching the configured lifetime.

**🛡 Passwords are never stored in the clear** ✅
Only a bcrypt hash reaches PostgreSQL. Verified by a test that registers with a
distinctive password, captures all stdout for that request, and asserts the raw string
appears **nowhere** in the output — a full-text scan rather than a field-by-field check,
so it catches leaks through error messages, stack traces, or stringified objects too.

## Security decisions and why

| # | Decision | Reasoning |
|---|---|---|
| 002 | **JWT: 1 hour, no refresh token** | Refresh flow means a second token type, rotation, and revocation — real scope that deserves to be built once deliberately. **Tradeoff: a stolen token is valid up to an hour and cannot be revoked.** |
| 003 | **Register hardcodes role `sales`** | If registration accepted a role from the request body, anyone could create themselves an admin and S-14's RBAC would be decorative. An admin is bootstrapped separately from env vars. |
| 004 | **Password 10–72 characters** | bcrypt silently truncates past 72 bytes, so we reject rather than let that happen quietly. |
| 005 | **Rate limit: 10 requests / 15 min / IP** | Brakes online brute force. **In-memory and single-instance — will not hold across replicas.** |
| 006 | **bcrypt cost factor 12** | ~250–300ms per hash. See the conflict below. |

## A requirements conflict that needs Ali's ruling
REQ-017 sets a p95 under 200ms. **bcrypt at cost 12 exceeds that on its own**, by design —
the slowness *is* the security mechanism, not incidental latency. Weakening the cost
factor to hit a generic performance target would be the wrong trade. Proposal: scope
REQ-017's p95 target to data endpoints and exempt auth endpoints explicitly.
**This needs to be Ali's decision in writing, not a silent choice in code.**

## Two attacks closed that weren't in the original spec
1. **User enumeration.** A wrong password and an unknown email return byte-identical 401
   responses — same body, same Content-Length, same ETag. Otherwise login becomes a free
   oracle for discovering which staff have accounts.
2. **Timing side-channel.** Identical error text isn't enough: if an unknown email skips
   bcrypt entirely it returns measurably faster, leaking the same information. Both paths
   now run a bcrypt comparison, using a dummy hash when the email isn't found.

## Race conditions
Email uniqueness is a database `UNIQUE` constraint, not a check-then-insert in
application code — which would be a TOCTOU race where two concurrent registrations both
pass the check. The app catches Postgres error `23505` and returns 409. Verified against
the live container by firing two simultaneous registrations with `Promise.all`: result
was exactly `[201, 409]` and one row.

## Tests
30 pass, 3 skip by design (2 gated on `DATABASE_URL`, 1 on `RUN_TIMING_TESTS`). tsc clean.
The timing-parity test is deliberately non-blocking with wide tolerance — it exists to
catch someone deleting the dummy-hash compare, not to police exact timings in CI. The
unconditional guarantee is the identical-response-body test.

Also fixed `migrate.test.ts` from S-01: it asserted the database started un-migrated,
which made it depend on external state and would have been a coin flip in CI. It now
creates a uniquely-named throwaway schema, points a dedicated pool's `search_path` at it,
and drops it afterward — keeping both assertions honest rather than deleting the weaker one.

## Known limitations, stated honestly
- **No path to a recruiter account exists** until S-14. Registration hardcodes `sales`;
  bootstrap creates exactly one admin. There is no recruiter to demo with.
- No RBAC enforcement yet — the role is stored and transmitted faithfully, but no route
  gates on it. That is S-14 (REQ-011), scheduled for R3.
- Rate limiting is in-memory and single-instance.
- No token revocation.
- The definition of done ends with "runs in the deployed demo." There is no deployed demo
  until S-20, so this story is complete against the local stack.

## Next
S-03 — first vertical slice, one signal becomes one opportunity. **Blocked:** needs the
confidence-score factors and weights, which are a business decision the spec says not to
invent.
