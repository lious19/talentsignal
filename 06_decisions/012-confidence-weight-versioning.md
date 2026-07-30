# 012 — Confidence weight versioning (S-07)

**Date:** 2026-07-30
**Story:** S-07
**Requirement:** REQ-003
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question
Once decision 007's confidence weights are approved (or later changed), how does a score
that was already stored stay traceable to the exact weights that produced it — and where
does that version identifier live?

## Options considered
1. A separate `scoring_weight_versions` table: one row per historical config snapshot,
   referenced by a foreign key from `opportunities`.
2. A single `version` string field added directly to `CONFIDENCE_CONFIG`, stamped onto
   every scored row at write time as a new `weights_version` column — no separate table.

## What we chose, and why
Option 2. It matches decision 007's own philosophy — one exported config object is the
single source of every number the scorer depends on — and doesn't build a many-row
history table for a single-tenant demo that only ever has one active weight set at a time.
Bumping `CONFIDENCE_CONFIG.version` by hand whenever the weights actually change is the
same one-line-edit discipline decision 007 already established for the weights
themselves; the change should still be logged as its own decision entry when it happens,
so `version` strings always trace back to a written reason, not just a git diff.

`scoreSignal()` returns `weightsVersion: CONFIDENCE_CONFIG.version` alongside the score,
reasons, and structured factor breakdown; `upsertBatch` in `hiddenDemand.ts` persists it
in a new `weights_version` column (migration `005_opportunity_scoring_breakdown.sql`),
next to a new `factor_breakdown` JSONB column holding the weight/value/contribution per
factor. Both are exposed on every response that carries a score, so a manager inspecting
an opportunity always sees which weights produced it, not just the number.

## What this rests on
That weight changes are rare, deliberate events (a new decision file each time), never a
silent hotfix to the numbers without also bumping `version` — and that this project only
ever runs one active weight configuration at a time, never several in parallel.

## What would make this wrong
If Ali wants multiple weight configurations live simultaneously (e.g. per-client or
per-industry scoring profiles), or wants first-class reporting like "how many
opportunities were scored under weights version X" across many historical versions, a
bare string column can't give either of those for free — that would justify the real
versions table option 1 describes.

## Known, accepted gap — rows scored before this migration
Migration 005 backfills every pre-existing `opportunities` row with
`weights_version = 'unversioned-backfill'` and `factor_breakdown = '[]'`. This is **not
recoverable**: the table never persisted the raw signal (`daysOpen`/`isRepost`/
`hasSalaryRange`) that produced a row's score, only the derived `confidence_score` and
`reasons` strings, so there is nothing to reconstruct a real breakdown from after the
fact. A manager inspecting one of those specific old rows would see an empty breakdown —
which is exactly the black-box the S-07 trust scenario forbids, and this decision does not
pretend otherwise.

The gap is handled operationally, not papered over in code: the demo runs from a freshly
migrated, empty database (`docker compose down -v` before demoing), so every opportunity
visible at demo time was analyzed after this migration and carries a real breakdown. The
frontend also has a defensive fallback (`OpportunitiesList.tsx` shows "No factor breakdown
recorded (scored before S-07)" instead of a blank list) in case a backfilled row is ever
visible outside that controlled demo setting.
