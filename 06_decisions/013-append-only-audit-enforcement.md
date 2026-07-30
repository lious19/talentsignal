# 013 — Making sales_pipeline_audit trustworthy: enforcement, concurrency, and erasure

**Date:** 2026-07-30
**Story:** S-08
**Requirement:** REQ-013 (S-15 formalizes reading this table)
**Decided by:** Megan

## The question

Three separate questions turned out to be one design question — "how do we make
`sales_pipeline_audit` trustworthy" — answered here together rather than in three
disconnected decisions:

1. How is append-only actually enforced (TBI rule 3: "by database constraint, not app
   code")?
2. Can a race condition make a written row *inaccurate*, even if append-only guarantees
   it can never be *altered* afterward?
3. `changed_by` identifies a staff member — is that a privacy problem, and if so, what
   do we do about it?

## Part 1 — append-only: a trigger, not REVOKE

### Options considered
1. `REVOKE UPDATE, DELETE ON sales_pipeline_audit FROM` the app's DB role.
2. A `BEFORE UPDATE OR DELETE` trigger that unconditionally `RAISE EXCEPTION`s.

### What we chose, and why

The trigger — because REVOKE does not work *in this deployment*, not because REVOKE is
a bad idea in general.

`docker-compose.yml` defines exactly one Postgres role (`POSTGRES_USER`, default
`talentsignal`), passed straight into the official `postgres:16-alpine` image. That
image's own bootstrap process makes this role a Postgres **superuser** —
`initdb` has no mechanism to create a non-superuser bootstrap role. The backend's
`DATABASE_URL` connects as this exact same role, and `backend/src/db/migrate.ts` — which
runs this table's own `CREATE TABLE` — runs through this same pool/role too. A repo-wide
grep for `CREATE ROLE|CREATE USER|GRANT|REVOKE` returns zero hits: no second, restricted
role exists anywhere in this stack.

Two independent facts each kill REVOKE here, either sufficient alone: a Postgres
**superuser bypasses every privilege check unconditionally**, and separately, a table's
**owner is exempt from ordinary GRANT/REVOKE-based restrictions** on objects it owns
(and this migration, run as `talentsignal`, makes that role the owner). REVOKE would be
silent dead code — the role could still UPDATE/DELETE audit rows freely, and nothing
would ever say so.

A trigger doesn't have this problem: triggers are procedural code Postgres runs before
completing an operation, for *any* role, superuser included — they sit outside the ACL
system REVOKE lives in. The only way around one is `ALTER TABLE ... DISABLE TRIGGER`, a
loud, explicit, logged DDL statement, never a side effect of ordinary app code.

### What this rests on
This deployment has exactly one Postgres role, ever. If S-14's RBAC work ever introduces
a genuine second, non-superuser, non-owner application role, REVOKE becomes the
textbook-correct belt-and-suspenders addition on top of the trigger — not a replacement
for it, since the trigger is the only mechanism that also survives a future
superuser/admin connection.

### What would make this wrong
If a future story introduces a second Postgres role for the running app that is
genuinely not a superuser and does not own this table, revisit whether REVOKE should be
layered on as well.

## Part 2 — a race can make a written row inaccurate, even though it can't be altered

Append-only only guarantees a row can't change *after* it's written — it says nothing
about whether it was accurate *when* written. `SELECT ... FOR UPDATE` locks a row so a
second transaction blocks until the first commits, but it can only lock a row that
**exists**. Two requests racing to enroll the *same brand-new* client both find nothing
to lock, both read `priorStatus = null`, and whichever commits second would still write
an audit row claiming `from_stage: null` — even though a real prior stage already
existed by the time it actually wrote. That's a genuinely inaccurate row, on the one
table whose accuracy this entire story exists to protect.

### What we chose, and why
A transaction-scoped Postgres advisory lock, keyed by `client_id`
(`pg_advisory_xact_lock(hashtext(client_id)::bigint)`), acquired before the read. Unlike
a row lock, an advisory lock exists independently of any row, so it serializes "is there
already a row for this client" checks even when the answer is currently no. It
auto-releases at `COMMIT`/`ROLLBACK`, so it needed no change to the existing
try/catch/`finally { client.release() }` shape. A second concurrent call for the same
`client_id` now simply waits for the first to fully commit, then reads the real,
up-to-date prior status.

### What this rests on
A 32-bit `hashtext` collision between two different client ids is astronomically
unlikely at any realistic client count, and even if one occurred, the code inside the
lock still re-reads the real row keyed by the actual `client_id` — a collision can only
cause two unrelated clients to briefly serialize against each other, never a wrong audit
row.

### What would make this wrong
Proven wrong only if a real Postgres round trip shows two concurrent enrollments of the
same new client still produce an inaccurate chain — covered by
`backend/tests/salesPipeline.concurrentEnrollment.integration.test.ts`.

## Part 3 — `changed_by` is personal data, but exempt from erasure

`sales_pipeline_audit.changed_by` stores a staff member's user id — that identifies a
person, so under GDPR/CCPA it is personal data, per `06_decisions/009`'s own standard
(an identifier is PII even when it must stay visible/retained). But an audit trail is a
standard, well-established exemption from erasure — erasing who-did-what-when defeats
the entire purpose of keeping the log (e.g. GDPR Art. 17(3)'s legal-compliance/
record-keeping exceptions).

### What we chose, and why
Registered `sales_pipeline_audit.changed_by` in the `pii_fields` registry
(`06_decisions/009`), with a new `erasure_strategy` value: `retain_exempt` (009 only
defined `reset_to_empty`/`anonymize` so far). `redact_from_display: false`, since the
whole point of the trust scenario is that a manager sees *who* moved a client.
Registering this now, rather than leaving `changed_by` out of `pii_fields` entirely, is
exactly the retrofit 009 warns about: if S-15's erasure path loops over `pii_fields`
generically and this column isn't in it, a future eraser either misses an unregistered
PII column, or someone adds it later without a distinct "retain" outcome to reach for.
Registering it now, with the right strategy value, means S-15 finds it already knowing
it must be retained, not erased.

### What this rests on
S-15 treats `retain_exempt` as a recognized, no-op outcome in its generic erasure loop
(skip the row, don't touch it), the same way it will act on `reset_to_empty`/`anonymize`
for other rows.

### What would make this wrong
If Ali or legal counsel decide staff-audit records must be erasable on request after
all (e.g. a jurisdiction without an audit-trail carve-out), this becomes a real erasure
strategy (likely `anonymize` — replace `changed_by` with a placeholder, keeping the
stage-transition history intact) instead of `retain_exempt`. Flagged in
`07_meeting_notes/for-ali-when-back.md` for his ratification, not decided as settled.
