# 019 — Recommendation feedback: keying, scope, and an open history question

**Date:** 2026-08-01
**Story:** S-11
**Requirement:** REQ-008 ("should"), REQ-020
**Decided by:** Megan — the keying itself is specified directly by the story; the scope
and history questions below are judgment calls, PROPOSED / open for Ali

## The question

S-06's `scoreCandidate()` already does "recommend candidates with a reason" — S-11 reuses
it unchanged (see `recommendationEngine.ts`, same discipline as S-07 reusing the
confidence scorer). The only new design surface is the feedback loop: how is a thumbs
good/bad mark identified and stored, given recommendations themselves are never persisted?

## What we chose, and why

**Keying: `(job_id, candidate_id, recruiter_id)`, unique, upserted.** This is directly
specified by the story text itself, not an invented judgment call: "recommendations are
computed on the fly (no persisted recommendation row), so feedback is keyed by (jobId,
candidateId) + recruiter." Logged here formally per the "propose and log" instruction,
matching the schema in migration `009_recommendation_feedback.sql`.

**Reversible, not append-only.** Same reasoning as decision 018 (S-10's
`relationship_path_decisions`): this table isn't protecting an accountability trail S-15
needs to read, it's a banked signal for a tuning process that doesn't exist yet. A
recruiter can flip good↔bad and the upsert just updates the one row —
`recruiter_id` is registered `reset_to_empty` in `pii_fields`, not `retain_exempt`, for
the same reason 018 drew that line: `retain_exempt` stays reserved for the
DB-trigger-enforced audit tables (`sales_pipeline_audit`,
`opportunity_package_release_audit`).

**Scope: `/recommend` shows only the CALLING recruiter's own mark, not a cross-recruiter
aggregate.** Nothing in the story asks for "3 recruiters said good, 1 said bad" — that
would be an aggregation model invented on top of what's actually specified. A recruiter
sees their own prior judgment on a candidate (so the UI can show "you marked this good"
and let them reverse it), and nothing more. Small, deliberate scope limit, not an
oversight.

## Open question, flagged not solved — does "over time" mean history, not just latest?

The upsert design keeps only the LATEST mark per (job, candidate, recruiter) — a
good→bad reversal overwrites, it doesn't append to, the row. That satisfies the literal
acceptance criterion ("feedback is stored... against the recommendation"). But the TBI
trust framing is more specific: feedback is captured "to check for and correct bias **over
time**." That phrase is a real hint that bias analysis might eventually need the sequence
of how a recruiter's judgment on a candidate changed, not just their current opinion —
e.g. "did this recruiter's marks on candidates from underrepresented backgrounds change
after review?" is a question an upsert-only table structurally cannot answer, because the
earlier marks are gone.

This plan deliberately does NOT build an event log now. S-11 is a "should," explicitly
asked to bank a signal, not build analysis tooling — adding an append-only history table
nobody has asked for yet would be exactly the over-building CLAUDE.md rule 4 warns
against ("no silent assumptions... stop and ask"). So: flagged here as a genuine open
question for Ali, not resolved unilaterally.

### What this rests on

That "bank the signal now" means the CURRENT signal is what's needed for now, and history
can be added later without disrupting anything reading the current-state table.

### What would make this wrong

If Ali confirms bias-over-time analysis needs the full event stream, the fix is additive:
a `recommendation_feedback_events` append-only table alongside this one (insert-only, one
row per feedback action, never updated) — the same mutable-state-plus-history split
`sales_pipeline`/`sales_pipeline_audit` already establishes in this codebase. The route
would insert into both tables in one transaction; `recommendation_feedback` itself and its
upsert behavior wouldn't need to change. Flagged in `07_meeting_notes/for-ali-when-back.md`.
