# To discuss with Ali when he's back
He's out for a week (as of Jul 22). Proceeding on documented judgment calls; nothing here
blocks building, but each needs his eventual sign-off.

## Decisions made in his absence (need ratification)
1. **Confidence-score weights (decision 007).** Not specified anywhere in the spec —
   confirmed by searching the full Build Guide (evidence in 007b). I authored a transparent
   proposal; every constant is in one config object, so his answer is a one-line change.
   Now load-bearing since S-04 ranks the whole board by them.
2. **TypeScript** chosen over JavaScript (the DoD says "tsc clean"). Confirm.
3. **JWT: 1 hour, no refresh** (decision 002). Tradeoff: a stolen token lives an hour.
4. **REQ-017 vs bcrypt conflict.** The p95 <200ms target and bcrypt cost 12 can't both hold
   on auth endpoints — the slowness is the security. Proposed: scope the p95 target to data
   endpoints, exempt auth. Needs his ruling.

## Questions that will come up in R1
5. **Recruiter account creation, resolved (decision 010).** Built `POST /api/admin/users`,
   admin-only, so an admin can create a recruiter (or any role). No second bootstrap
   mechanism — demo flow is "log in as bootstrapped admin, create the recruiter." Confirm
   this matches the onboarding flow he had in mind past the demo.
6. **PII tagging approach, resolved (decision 009).** A `pii_fields` registry table, seeded
   in S-05's first migration. Two independent facts per column, not one: `erasure_strategy`
   (what S-15 executes) and `redact_from_display` (what S-05 hides today). `candidates.name`
   is registered as PII (S-15 must be able to anonymize it) but *not* hidden from display —
   `contact_info` is both. Worth his eye since it's the compliance foundation S-15 builds on.
7. **Field-level vs whole-record PII gating (S-05) — decided with Megan, not yet with Ali.**
   S-06 (due 3 days after S-05) needs any authenticated role to read `candidates.name`/
   `skills`. S-05's trust scenario says "PII columns... access is role-gated." Read literally
   as whole-record, that blocks S-06. Megan chose field-level (gate `contact_info`
   specifically, leave `name` readable) — a conscious call made this session, not something
   already agreed with Ali. If he reads it differently, `backend/src/routes/clients.ts` /
   `candidates.ts` and S-06's candidate-read path both need revisiting.

## Process / scope
8. **"Runs in the deployed demo" clause.** Nothing deploys until S-20, so every story is
   "done" against the local stack, not the literal DoD. Reading it as local-now, deploy-later.
9. **Phase-gate dates contradict story dates.** Gate 1 dated Jul 21 but R1 runs to Jul 30;
   Gate 3 Aug 11 but R4 runs to Aug 21. Which is authoritative?
10. **Deploy credentials / hosting for talentsignal-demo.colaberry.dev** — who provisions it,
    and do I have access? Needed well before S-20.

## Decisions made in his absence, S-08
11. **Append-only audit enforcement, concurrency fix, and an erasure exemption
    (decision 013).** Enforced by a DB trigger, not REVOKE — this deployment's one
    Postgres role is a superuser and this table's owner, so REVOKE would be silent dead
    code. Also closed a race where two concurrent enrollments of the same brand-new
    client could both write an inaccurate `from_stage: null` audit row, via a
    transaction-scoped advisory lock. And: `sales_pipeline_audit.changed_by` identifies
    a staff member (personal data under GDPR/CCPA) but is registered as
    `retain_exempt` in `pii_fields` — audit trails are a standard exemption from
    erasure, not a gap. Flagging so S-15 treats this as a ratified exemption, not
    something it discovers and has to resolve itself.
12. **Pipeline stage transitions are freeform, not a forced sequence (decision 014).**
    Any stage can move to any other, including backward. Confirm this matches the
    sales process he had in mind, or tell me which reversals (if any) should be
    blocked.

## Decisions made in his absence, S-09
13. **Opportunity ↔ job-opening linkage, and top-candidate count (decisions 015, 016).**
    `opportunities` (market signals) and `job_openings` (platform data) have no FK
    relating them, so `POST /opportunity-package/draft` requires both `opportunityId`
    and `jobOpeningId` explicitly rather than inventing a link that doesn't reflect how
    SignalAgent and reps actually produce data. Packages carry the top 3 ranked
    candidates (PROPOSED, config constant, easy to change).
14. **Open S-15 question — erasure of a RELEASED package's content.** A drafted
    package's `content` (embeds a candidate's name) is `reset_to_empty` on erasure,
    same as any other PII column. But a *released* package is a record of a human
    decision, not disposable AI output — Ali may want it retained instead, the same way
    `sales_pipeline_audit.changed_by` is `retain_exempt` (decision 013). Not decided;
    flagging because a status-dependent erasure strategy is more than S-15's current
    per-column `pii_fields` model supports, so his answer may also shape a small S-15
    design change. Also: `opportunity_package_release_audit.released_by` and
    `opportunity_packages.released_by` are both registered `retain_exempt` already,
    mirroring 013 — that part isn't in question, just the `content` column.

## Decisions made in his absence, S-10
15. **Relationship edge model, search scope, and the opportunity to client anchor
    (decision 017).** No new `client_contacts` table — edges connect `users` and
    `clients` only, the two entities that already have real ids; a "client contact" is
    company-level for now. Edges are stored undirected. Path search spans the whole
    agency's relationship graph, not just the calling rep's own edges — "ask Jordan,
    not you" is the point. Anchoring an opportunity to a client hits the SAME no-FK gap
    as 015 (opportunities have no `client_id`), resolved differently here because the
    route's contract leaves no room for a caller-supplied id: a case-insensitive exact
    match on `company`/`clients.name`. No fuzzy matching — a naming mismatch silently
    surfaces zero relationships. Worth resolving alongside 015 if a future story
    properly links opportunities to clients.
16. **Relationship path confidence weights, and why confirm/dismiss isn't an audit
    table (decision 018).** `strong`=0.8/`weak`=0.4 per edge, multiplicative
    combination, 0.6 penalty per hop beyond the first — PROPOSED, same style as 011/016.
    `relationship_path_decisions` is a plain mutable table, not append-only like
    S-08/S-09's audit tables: S-10's trust scenario only asks for a recorded
    confirmed/dismissed state, not a history of every flip-flop, and unlike S-09's
    release, a decision is reversible (it only gates an internal signal, nothing
    currently leaves the platform on it either way).

## Decisions made in his absence, S-11
17. **Recommendation feedback keying and scope (decision 019).** Keyed by (job,
    candidate, recruiter) as the story itself specifies — logged formally, not really an
    open question. `/recommend` shows only the calling recruiter's own mark, not a
    cross-recruiter aggregate nobody asked for.
18. **Open question — does "check for and correct bias OVER TIME" mean feedback needs a
    history, not just the latest mark?** The current design upserts one row per
    (job, candidate, recruiter) — a reversal overwrites the earlier mark, it doesn't keep
    it. That satisfies the literal "feedback is stored" acceptance criterion, but if bias
    analysis eventually needs to see HOW a recruiter's judgment changed over time (not
    just where it landed), an upsert-only table can't answer that — the earlier value is
    gone. Deliberately not built now (S-11 is a "should," asked to bank a signal, not
    build analysis tooling) — flagged as a real open question rather than guessed at. If
    yes, the fix is additive: an append-only `recommendation_feedback_events` table
    alongside the existing one, same split as `sales_pipeline`/`sales_pipeline_audit`.
