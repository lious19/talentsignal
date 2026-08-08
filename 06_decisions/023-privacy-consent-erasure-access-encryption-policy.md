# 023 — Privacy policy: consent default, erasure scope, access contents, encryption level

**Date:** 2026-08-08
**Story:** S-15
**Requirement:** REQ-012, REQ-013
**Decided by:** Megan — PROPOSED, pending Ali's approval. S-15 itself calls these out as
🧑 HUMAN policy decisions, same framing as decisions 007, 009, 020, 022: propose, log,
flag for Ali since he's out.

## The question

S-15 asks for four things a person or business decision has to answer, not code alone:
what does the consent flag gate and what's its default; what exactly gets erased and
what's exempt; what a person gets back when they ask "what do you hold on me"; and what
"encryption at rest/in transit" honestly means for this stack right now.

## 1. Consent — what it gates, and the default

**What it gates:** whether `candidates.contactInfo` appears in the ordinary staff-facing
CRUD responses (`GET/POST/PUT /api/candidates...`) — `toCandidateResponse()` in
`candidates.ts` now requires both the existing `PII_VISIBLE_ROLES` role check **and**
`consent_given === true`. It does **not** gate the S-15 privacy-request workflow's own
reads/writes (`piiRegistry.ts` reads raw columns directly, bypassing this function
entirely) — a person's right to see or erase their own data is unconditional, and can't
be conditioned on a marketing-style consent flag.

**Scope:** `candidates` only, not `clients`. Ali's build note says "on candidates, maybe
clients" — `clients.contact_info` is a business's contact person, and extending consent
semantics to B2B contact data is a separate, unscoped judgment call. Additive later (same
`ALTER TABLE` pattern) if Ali wants it.

**Default: `consent_given BOOLEAN NOT NULL DEFAULT true`.**

### Options considered
1. Default `false` (opt-in) — the GDPR-faithful posture.
2. Default `true` (opt-out) — preserves current behavior.

### What we chose, and why
Option 2, **explicitly not because it's the correct production posture** — it isn't. The
GDPR-faithful default is opt-in (`false`), paired with an actual consent-collection step
upstream of candidate creation. Neither exists in this product today:
`CandidatesScreen`'s create form has no "did they consent" field anywhere. Defaulting to
`false` right now wouldn't reflect any real consent failure — no consent process has ever
run, successfully or not — it would just make every existing and newly-created
candidate's contact info silently vanish from the UI, and break every existing
PII-visibility test (`candidates.crud.test.ts`, `pii.redaction.test.ts`,
`clientMatchmaking.pii.test.ts`, `fakeCandidatesPool.ts`). `true` is chosen as a
documented, honest exception: it preserves everything that already works, and adds a
real, testable **revoke** path.

**The demonstrable trust scenario is the revoke round-trip, not the default value.** Flip
an existing candidate's `consent_given` to `false` via `PUT /api/candidates/:id` (already
role-gated to `PII_VISIBLE_ROLES`) → `contactInfo` disappears from every subsequent
response, for admin and recruiter alike → flip back to `true` → it reappears. That
round-trip — not which value ships as the default — is what proves "consent gates use."
Covered by `candidates.consent.test.ts`.

`consent_recorded_at` is stamped whenever `consent` is explicitly set via `PUT` (omitting
it from the body leaves both fields untouched, so no existing caller can accidentally
reset consent back to `true`). Neither column is registered in `pii_fields`: they're
metadata about permission state, not identifying data themselves, so an erasure request
leaves them intact by omission — the record of when consent last changed survives
erasure, the same practical effect as `retain_exempt` without needing a new registry
value for a column that isn't really "PII" in the sense name/contact info are.

### What this rests on
That "opt-out with a visible, working revoke path" is an acceptable interim posture for a
demo with no consent-collection UX yet, not a permanent design choice.

### What would make this wrong
If Ali wants opt-in enforced now regardless of the UX gap — say so, and this reverses
cleanly: flip the migration's `DEFAULT` to `false`, update the four fixture files listed
above to `consent_given: false` where they need contact info visible, and treat consent
collection at candidate-creation time as a small additive follow-up story. The gating
*mechanism* (role AND consent) doesn't change either way.

## 2. Erasure scope + what's exempt

Driven entirely by `pii_fields.erasure_strategy`, looped generically
(`backend/src/privacy/piiRegistry.ts`), not hardcoded:
- `reset_to_empty` (`candidates.contact_info`, `clients.contact_info`) → wiped to the
  type-appropriate empty value (`{}` for jsonb, looked up via
  `information_schema.columns`).
- `anonymize` (`candidates.name`) → replaced with a fixed placeholder (`[erased]`).
- `retain_exempt` (audit `changed_by`/`released_by` columns, plus the new
  `privacy_requests.requested_by`/`privacy_audit_log.actor`) → never touched, not even
  attempted. This carve-out already exists and is ratified per decision 013 and
  `07_meeting_notes/for-ali-when-back.md` item 11 — S-15 treats it as settled.

**Explicitly not resolved here:** decision 015 left open whether a *released*
`opportunity_packages.content` (which embeds a candidate's name) should become
`retain_exempt` instead of `reset_to_empty` once released — the registry only supports
one strategy per column today, not per row-state. This story **leaves it as-is**
(unconditional `reset_to_empty`, matching the current registry row) rather than building
row-state-aware strategies speculatively. Flagged again, not silently resolved — decision
015 is still the open thread for Ali on this specific point.

**Explicitly out of scope:** erasure only reaches the subject's own row in
`candidates`/`clients`. It does not chase a candidate's name into
`opportunity_packages.content`, `relationship_edges.notes`, or anywhere else it might be
embedded — those are separately registered `pii_fields` rows against their own tables,
not derivable generically without per-table logic that would defeat "loop the registry,
don't hardcode." **Known limitation, stated plainly:** an erasure request against a
candidate does not scrub copies of their name that already exist inside other tables'
JSON/text columns.

## 3. Access-request contents

Every `pii_fields`-registered column's current value from the subject's own row in their
primary table — for a candidate: `{ name, contactInfo }`; for a client:
`{ contactInfo }`. Symmetric with erasure scope above, for the same reason: the registry
is the one honest, generic source of "what counts as PII we hold." The same known
limitation applies: this does not include copies embedded elsewhere.

The audit trail (`privacy_audit_log.detail`) records which **column names** were
returned, never the values — the values exist only in the HTTP response to the
authenticated caller, never persisted anywhere. This is deliberate: an audit log holding
raw PII values would become a second, harder-to-govern copy of the data it's supposed to
be governing.

## 4. Encryption — config, not code

**At rest:** infrastructure-level, not application code. The demo runs
`postgres:16-alpine` in Docker Compose against a named volume with **no disk/volume-level
encryption configured** — stated plainly, not hand-waved. Production would need either a
managed Postgres offering with encryption-at-rest on by default, or LUKS/dm-crypt under
the container volume — neither built here. No hand-rolled column-level encryption
anywhere in this codebase.

**In transit, two hops, different maturity honestly stated:**
- **App ↔ Postgres:** plain TCP over the Docker Compose private bridge network today
  (`db:5432`) — confirmed in `docker-compose.yml` and (previously) `pool.ts`, no `ssl`
  option was set. Added an off-by-default `DATABASE_SSL` env var to `createPool()` so a
  production deployment against a network-separated Postgres can turn on TLS without a
  code change — it stays unset for the demo, and being present in the code is not itself
  a claim that transit encryption is running anywhere right now.
- **Client ↔ backend (public internet):** genuinely needs TLS in production, but *how*
  (reverse proxy, platform-managed cert) is an S-20 deployment decision that doesn't
  exist yet — no `S-20.md` found in `00_scope/stories/`. Documented as S-20's
  responsibility, not guessed at here.

Full writeup: `00_scope/privacy-encryption-config.md`.

## What this whole decision rests on

That "honest and demo-scoped, with the mechanism ready to switch on" is an acceptable
posture for encryption and consent alike, given this is a pre-production demo with no
consent-collection UX and no finalized deployment story yet — not a claim that any of
this is production-ready as shipped.

## What would make this wrong

If Ali wants opt-in consent enforced immediately (see §1), or wants decision 015's
released-package question resolved now rather than left open (see §2), or wants
encryption-at-rest actually configured before the class demo (see §4) — each reverses
independently, without touching the others. None of these four sub-decisions depends on
the others being right.
