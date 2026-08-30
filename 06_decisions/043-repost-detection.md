# 043 — Repost detection: absence-based + requisition_id-based, and where the differ runs

**Date:** 2026-08-30
**Story:** S-22
**Requirement:** ticket acceptance criteria 1 ("a requisition that disappears and later
returns is detected as a repost, not as a new record") and 3 ("re-running the differ over
an unchanged board is a no-op")
**Decided by:** Megan, approved from a plan-mode research pass (Angel gave the ticket)

## The question

Two things needed deciding: (1) what actually counts as "reposted" when neither
Greenhouse's nor Lever's public API exposes a repost flag, and (2) where the diff
computation runs, since that determines whether its output ever reaches the two scorers
that already consume `isRepost`/`daysOpen`.

## What we chose, and why (algorithm)

**Both signals, whichever fires, capped at +1 per fetch:**

- **Absence-based:** `(source, external_id)` seen at some fetch, missing from a later
  fetch, seen again after that — this is the only algorithm that can satisfy criterion 1
  as literally written.
- **`requisition_id`-based (Greenhouse only):** confirmed live in
  `tests/fixtures/greenhouse/gitlab.json` — every job carries a real `requisition_id`.
  06_decisions/040 already flagged this as a genuine ATS repost signal Ali called out: the
  same `requisition_id` reappearing under a *new* job id is how Greenhouse represents a
  reopened requisition that may never itself return under its old id — a case
  absence-based detection structurally cannot see (the old external_id never reappears).
  Lever carries no equivalent field, so this path is Greenhouse-only.

The two paths are mutually exclusive by construction in this implementation:
absence-based only evaluates when prior rows for the SAME external_id exist;
requisition_id-based only evaluates on that external_id's first sighting (when, by
definition, no prior rows exist). So "capped at +1" never actually needs to resolve a
genuine double-fire in this codebase, but the rule is stated explicitly rather than left
as an accident of the current implementation.

## Necessary addition discovered during implementation: `run_id` on `raw_requisitions`

`raw_requisitions` (migration 015) records presence only — one row per item a fetch
actually returned. A bare `fetched_at` gap on an item's own rows cannot distinguish "the
board was polled and this item genuinely wasn't there" from "the board was simply never
polled again" — both look identical (no row) from the item's own history alone. Detecting
a real absence requires knowing whether OTHER rows exist for the same source in the
window between two of this item's own sightings — proof the board actually was checked.

**Fix (migration 017):** a nullable `run_id UUID` column on `raw_requisitions`, populated
from `ingestRequisitions.ts`'s existing per-run `correlationId` (already threaded through
every log line, CLAUDE.md rule 8 — reused here rather than inventing a second id scheme).
The absence check becomes exact: "does any row for this source, run_id IS NOT NULL,
external_id != this one, exist with fetched_at strictly between this item's own two
sightings." Old rows from before this migration have no run_id and are simply excluded
(`WHERE run_id IS NOT NULL`), not backfilled with a guess.

This mirrors 06_decisions/042's own precedent: a real gap found while building, not
predicted in the original plan, fixed and documented as its own decision rather than
silently folded into the story's file list.

## What we chose, and why (architecture — where the differ runs)

**Inline, per-item, inside each provider (`GreenhouseProvider`/`LeverProvider`), called
via the new `computeDiffs.ts` right after `persistRawRequisition()` and before that item's
`MarketSignal` is built** — not a later, separate pass over `opportunities`.

This is the one place this decision diverges from a naive reading of "where does the
differ run": `scoreSignal()`/`hardToFillScore()` read `MarketSignal.daysOpen`/`.isRepost`
once, in-memory, at the moment each provider builds it — never re-read from `opportunities`
afterward. A post-hoc pass would only ever update `opportunities`' display columns; it
could never make "the factors HF-1 already consumes become measured facts" literally true,
since that run's `confidence_score`/`hard_to_fill_score` would already be locked in with
the OLD (seeded) inputs. Computing the diff before `toMarketSignal()` runs means better
inputs reach both scorers on the SAME run, through the existing seam, with zero changes to
either scorer — exactly Ali's rule.

`upsertChunk()` in `hiddenDemand.ts` (persistence, not scoring) grows four more columns in
its existing `INSERT ... ON CONFLICT DO UPDATE` — one atomic write per chunk, not a second
pass touching the same row twice.

**Why this also satisfies criterion 4 for free:** both providers' fetch loops
(`for (const job of jobs)` / `for (const posting of postings)`) simply don't execute when a
board returns zero postings — nothing is read, diffed, or written. There is no
reconcile/delete-missing pass anywhere in this design that could zero out history on an
empty response; the boundary is safe by construction, not by a special case someone has to
remember.

## What this rests on

That Greenhouse's `requisition_id` field means what 06_decisions/040 verified it means
(not re-verified here). That `run_id`-tagged gap detection stays a cheap, indexed query at
S-21's current manual-trigger, small-board-list scale (06_decisions/041's own caveat about
`raw_requisitions` growth applies here too — a `computeDiff()` call issues one gap-window
query per historical transition per item per fetch; fine at today's scale, a candidate for
batching if ingestion frequency or history length grows enough to matter, same "prove the
failure mode is real before optimizing" posture as 06_decisions/042).

## What would make this wrong

If Ali wants only one of the two repost signals, or a minimum "must be absent for N
fetches" window before counting a reappearance as a repost (rather than any single missed
fetch). If the mutual-exclusivity assumption between the two detection paths stops holding
after some future change (e.g. absence-based detection is extended to also fire on repeat
sightings), the "+1 cap" logic would need to become a real dedup step, not just documented
intent. If `run_id`-based gap detection becomes a measured bottleneck, the query needs
batching (e.g. one gap-window query per item per full history walk instead of per
transition) rather than a bigger timeout.
