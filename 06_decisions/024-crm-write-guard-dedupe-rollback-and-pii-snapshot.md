# 024 — CRM write guard: dedupe basis, rollback scope, role gating, and an open erasure-vs-rollback question

**Date:** 2026-08-08
**Story:** S-16
**Requirement:** REQ-014
**Decided by:** Megan — dedupe basis, rollback scope, and role gating CONFIRMED this
session. The fourth item (erasure vs. rollback) is logged as an **OPEN question for
Ali**, not a settled decision — same framing as decision 015's still-open
released-package-content question.

## The question

S-16 asks for idempotency keys, a dedupe check, and a rollback path on writes to client
records. Three sub-decisions needed a proposal (dedupe basis, how much a rollback
restores, who can call these routes), and building the rollback snapshot surfaced a
fourth question S-16's own text doesn't raise: what happens when a rollback would
restore data a legitimate S-15 erasure request already scrubbed.

## 1. Dedupe basis — key-based, not fuzzy content matching

**Confirmed.** Ali specified idempotency keys explicitly ("Add idempotency keys on
CRM-bound writes"). Dedupe is entirely key-based — a `UNIQUE` constraint on
`crm_writes.idempotency_key`, claimed atomically via `INSERT ... ON CONFLICT (idempotency_key)
DO NOTHING RETURNING *` (the same race-safe idea `auth.ts` uses reactively via
`isUniqueViolation`/`23505`, used here proactively so the row count itself tells the
handler whether it won the claim). No content-similarity check of any kind — "same
key" is the only definition of "duplicate" this story implements. Clean, defensible, and
the only reading Ali's own words support; no real alternative was seriously considered.

## 2. Rollback scope — one level per write, not a checkpoint stack

**Confirmed.** `POST /api/crm/write/:writeId/rollback` reverts the `clients` row to
*that write's own* `before_image` — the snapshot captured immediately before that
specific write was applied. This is "undo this write," not "undo the last N writes" or
"restore to an arbitrary checkpoint." If write #3 happens after write #2, rolling back
#3 restores whatever existed right before #3 (which already reflects #2) — the literal
reading of Ali's Gherkin ("reverted to the prior known-good state," singular). A
multi-step undo stack or arbitrary-checkpoint restore is real, unrequested complexity
the acceptance criteria never asks for.

Race-safety reuses `opportunityPackage.ts`'s exact release-guard pattern: a conditional
`UPDATE crm_writes SET status = 'rolled_back' ... WHERE id = $1 AND status = 'applied'`.
A rollback can happen at most once per write; a second attempt gets `409` with the
current stored row, never a silent no-op or a double-application.

Rollback is an explicit, operator-initiated `POST` — there is no automatic "detect a bad
update and revert" logic. Nothing in the Gherkin asks for anomaly detection; "when it is
detected" describes a human noticing, not code deciding.

## 3. Role gating — `admin` + `sales`

**Confirmed.** Client-record writes sit in the same persona lane as `salesPipeline.ts`
("As a sales rep...", S-08) plus admin oversight, applied to both
`POST /api/crm/write` and its rollback route.

**Worth flagging for Ali's eye, not a blocker:** this creates a real asymmetry with
`clients.ts`'s existing `PII_VISIBLE_ROLES` (`admin`, `recruiter`) — under this matrix,
`sales` can *write* `contactInfo` via a guarded CRM write while being unable to *read*
`contactInfo` through the ordinary `GET /api/clients` endpoints. That's plausible as
"sales enters/updates contact details while closing a deal" (S-16's own persona is "As
an agency manager," not literally one of the three role names, same ambiguity decision
022 already noted for S-12), but it's a genuine inconsistency worth Ali's confirmation
rather than something to paper over. Not changed here since it matches what Megan
explicitly confirmed for this story; flagged for the record.

## 4. OPEN — erasure vs. rollback: does a rollback un-erase data?

**Not decided. Deliberately left open, the same way decision 015 left open the
released-package-content question, for Ali.**

`crm_writes.before_image`/`after_image` are JSONB snapshots containing a full copy of a
client's `name`/`contact_info` at write time. If a client's `contact_info` is later
erased via `POST /api/privacy/request` (S-15), these snapshots still hold the value from
*before* the erasure. Two paths were considered for how the PII registry should treat
these columns:

1. **Register `before_image`/`after_image` as `retain_exempt`** in `pii_fields` — the
   audit-trail carve-out decision 013 already established for `changed_by`/`released_by`.
2. **Leave them unregistered** — S-15's generic erasure loop only touches
   `pii_fields`-registered columns, so an unregistered column is simply never reached,
   the same "embedded copies" limitation decision 023 already names for
   `opportunity_packages.content`.

**Chosen: option 2, and explicitly NOT because it resolves the underlying tension —
because option 1 would be actively worse.** Registering these columns `retain_exempt`
mis-applies decision 013's reasoning: an audit log is a legal record of what happened,
rightly exempt from erasure. A rollback snapshot is different in kind — it's an
*operational undo buffer* whose entire purpose is to overwrite a live row's current
state with old data. If it's marked exempt and a rollback is later triggered on a write
that predates a client's erasure, the rollback would **restore the erased contact
info into the live `clients` row** — actively undoing a completed, lawful erasure. That
is a privacy violation, not a reasonable feature, and it would happen through a code path
(`piiRegistry.ts`'s erasure loop) that has no way to know a `crm_writes` snapshot exists
or that a rollback might later read it.

**The compliance-faithful lean, stated plainly, not resolved unilaterally:** erasure
should win. A rollback should not be able to restore a field a legitimate erasure
request already scrubbed. What that requires — checking erasure status before a
rollback is allowed to proceed, scrubbing `before_image`/`after_image` themselves at
erasure time (which would break rollback for any write predating the erasure), some
combination, or a different resolution entirely — is Ali's call. **No code enforces
this in S-16 as built.** The gap is real, named, and left open rather than silently
patched with a code-level guard that wasn't asked for and wasn't reviewed.

### What this rests on
That "documented gap, not silently exempted, and not silently guarded either" is the
right posture for a genuine cross-story tension discovered mid-build, rather than either
extreme (quietly granting an exemption that reopens a privacy hole, or quietly bolting on
enforcement logic for a policy question that's actually Ali's to answer).

### What would make this wrong
If Ali rules quickly and simply ("erasure wins, block rollback for writes older than any
erasure on that client" or similar), this becomes a small, additive follow-up: a check
in the rollback handler against `privacy_requests`/`privacy_audit_log` for that client,
not a redesign of anything built in S-16.

## What this whole decision rests on

That items 1–3 (dedupe basis, rollback scope, role gating) are correctly settled by
Megan's confirmation this session, and that item 4 is genuinely Ali's call, not a code
decision — consistent with CLAUDE.md rule 4's instruction to stop and ask rather than
invent silently.

## What would make items 1–3 wrong

If Ali wants content-based dedupe in addition to key-based (unlikely, given his own
wording), or a multi-level undo stack, or a different role split (see §3's flagged
asymmetry) — each reverses independently without touching the others or item 4.
