# 010 — How a recruiter account comes to exist

**Date:** 2026-07-25
**Story:** S-05
**Requirement:** REQ-010, REQ-011 (forward-looking)
**Decided by:** Megan — flagged for Ali, predicted in advance by decision 003

## The question

Decision 003 (S-02) closed off client-controlled role input: public registration
always assigns `sales`, and only the env-driven `bootstrapAdmin` can create an
`admin`. That left no path to a `recruiter` account at all. S-05 is a
recruiter-facing story, and its field-level PII gating (decision 009) needs a real
`recruiter`-role account, distinct from `sales`, to even demo or test against. The
gap decision 003 flagged three weeks in advance became load-bearing here.

## Options considered

1. **Admin-creates-user route** — `POST /api/admin/users`, gated to `requireRole(['admin'])`,
   body `{ email, password, role }`. Boot → admin logs in (env-bootstrapped) → admin
   creates the recruiter account.
2. **A second bootstrap** (`RECRUITER_EMAIL`/`RECRUITER_BOOTSTRAP_PASSWORD`),
   mirroring `bootstrapAdmin` — fast, but duplicates the bootstrap mechanism for a
   role that isn't as sensitive as admin, and doesn't answer the general onboarding
   question past this demo.
3. **Loosen self-registration** to accept `role: 'sales' | 'recruiter'` from the
   request body — fastest, but reopens ground decision 003 deliberately closed.

## What we chose, and why

Option 1. It's the exact route decision 003 predicted ("an admin-only 'create user
with role X' route should be pulled forward rather than waiting on full RBAC"). No
second bootstrap mechanism: the demo setup step is "log in as the bootstrapped
admin, `POST /api/admin/users` to create the recruiter."

## What this rests on

`requireRole` (new middleware, `backend/src/middleware/requireRole.ts`) exists and
is trustworthy — it's the same middleware decision 009's PII write-gating uses, so
this route and the PII gating share one code path for "is this role allowed here."

## What would make this wrong

If Ali wants a self-service recruiter path (no admin gatekeeper) for the real
product past this demo, that's a different, larger conversation — this route only
answers "how do I get a *first* recruiter account to demo/test S-05 with," not S-14's
eventual onboarding model.
