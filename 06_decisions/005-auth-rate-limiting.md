# 005 — Rate limiting on register/login

**Date:** 2026-07-22
**Story:** S-02
**Requirement:** REQ-010
**Decided by:** Megan

## The question
bcrypt cost 12 slows down each individual guess but doesn't stop an attacker
from simply sending many requests — it's a partial brake, not a real limit
on online brute force. Add rate limiting now, or defer it to S-14?

## Options considered
1. Defer to S-14 (RBAC/least-privilege story), name the gap explicitly.
2. Add a minimal limiter now, scoped to `/auth/register` and `/auth/login`.

## What we chose, and why
Option 2. `express-rate-limit`, in-memory, 10 requests per 15 minutes per IP,
applied to both auth routes. This is a small, self-contained addition — no
new infrastructure (no Redis) — and closes a real gap rather than leaving
online brute force effectively unmitigated between now and S-14.

## What this rests on
The limiter's store is in-memory, per process. That's correct for a single
backend instance (what we run today) but **is not shared across replicas**
if the backend is ever horizontally scaled — each instance would enforce its
own independent limit, effectively multiplying the real ceiling by the
instance count.

## What would make this wrong
If S-18 (performance/load) or S-20 (deployment) ever runs more than one
backend replica, this needs a shared store (Redis-backed limiter) instead of
the in-memory default — revisit at that point, not before.
