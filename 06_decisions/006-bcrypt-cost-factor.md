# 006 — bcrypt cost factor, and its tension with REQ-017

**Date:** 2026-07-22
**Story:** S-02
**Requirement:** REQ-010, REQ-017 (perf)
**Decided by:** Megan — flagged for Ali

## The question
What bcrypt cost factor, and how does it interact with REQ-017's p95 <200ms
(normal) / <500ms (peak) target?

## Options considered
1. Cost 10 (bcrypt's own default) — faster (~60-80ms/hash), weaker against
   offline brute force if a hash is ever leaked.
2. Cost 12 — current common baseline (~250-300ms/hash), stronger, but alone
   can exceed the REQ-017 p95 target on register/login specifically.
3. Cost 14+ — materially slower, likely a poor user experience for a
   login-on-every-hour token lifetime.

## What we chose, and why
Cost 12. The slowness is bcrypt's entire security mechanism, not incidental
latency — weakening it just to hit a generic perf number defeats its purpose.

## What this rests on
**Flag for Ali:** REQ-017's p95 target should be explicitly scoped to *data*
endpoints, with auth endpoints (`/auth/register`, `/auth/login`) called out
as an intentional exception. This needs to be a documented exception, not a
silent one — otherwise a future performance test could "fail" against a
requirement that was never meant to cover hashing-bound endpoints.

## What would make this wrong
If Ali says REQ-017 must hold everywhere with no exceptions, cost 12 would
need to drop to 10 (or lower), trading hash strength for the perf target —
that's a real security/performance tradeoff that should be made explicitly,
not discovered later in a failing load test.
