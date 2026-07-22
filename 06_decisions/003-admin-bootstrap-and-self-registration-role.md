# 003 — Self-registration role and admin bootstrap

**Date:** 2026-07-22
**Story:** S-02
**Requirement:** REQ-010, REQ-011 (forward-looking)
**Decided by:** Megan — flagged for Ali

## The question
If `POST /auth/register` accepts a `role` from the request body, anyone can
register themselves as `admin`. RBAC enforcement doesn't land until S-14, so
an early self-registered admin would be a permanent, undetected backdoor by
the time RBAC actually starts checking roles.

## Options considered
1. Force all self-registration to `role: 'sales'`; an existing admin promotes
   users to `recruiter`/`admin` later.
2. Seed exactly one admin via a migration or startup bootstrap.
3. Gate registration entirely — no public self-registration, every account
   admin-created.

## What we chose, and why
Options 1 and 2, combined — they're not actually alternatives, since option 1
alone still needs *some* way to get the first admin into the system.
- `POST /auth/register` never reads `role` from the request body at all — it
  is hardcoded to `'sales'` server-side. There is no code path from client
  input to an elevated role.
- On backend boot, `bootstrapAdmin` creates exactly one admin account if
  `ADMIN_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` are both set in the
  environment and no admin exists yet. Idempotent — safe on every restart.
  Both env vars are unset by default (no compose fallback), so no working
  admin credential is ever checked into git.

Option 3 (gate registration entirely) doesn't fit this story: Ali's build
note explicitly asks for a working register screen, and a fully gated
registration would contradict that deliverable.

## What this rests on
There is currently **no self-service path to becoming `recruiter` or
`admin`** — only `sales` via public registration, or `admin` via the env-var
bootstrap. Recruiter accounts have no creation path yet at all.

## What would make this wrong
**Flag for Ali:** how urgently is a self-service (or admin-created) path to
`recruiter` accounts needed before S-14 lands (~3 weeks out)? If sales-team
users need recruiter accounts sooner, an admin-only "create user with role X"
route should be pulled forward rather than waiting on full RBAC.
