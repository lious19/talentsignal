# 048 — Opportunity card "spread potential" and "top pick" heuristics (S-26 pre-demo redesign)

**Date:** 2026-09-15
**Story:** S-26 (pre-demo Opportunities screen redesign, no formal story file yet)
**Requirement:** none cited — new client-side display logic introduced by this task
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

The approved design mockup (`talentsignal-dashboard.html`) and the redesign
task both asked for two new pieces of card UI that don't correspond to any
existing backend field or prior decision: a "spread potential" badge
(high/medium/low) and a "top pick" star on one card. Both are scoring-adjacent
business logic (CLAUDE.md rule 4: no silent assumptions on thresholds), so
they're logged here rather than invented silently, even though they shipped
in the pre-demo build ahead of sign-off (explicit instruction, time-boxed to
a 10am demo).

## What we chose, and why

**Spread potential** (`computeSpreadPotential` in `OpportunitiesList.tsx`):
purely a client-side display heuristic, explicitly labeled as such in the UI
(info-icon tooltip: "Derived from confidence + days_open + role_family. Not a
measured spread."). Formula, as specified in the task:

- `low` if `days_open > 365` OR `confidence < 70%`
- `high` if `confidence >= 85%` AND `days_open <= 30`
- `medium` otherwise

This is **not** a dollar figure. A real spread would need `bill_rate` and
`pay_rate` fields that don't exist yet (spread = bill − pay) — noted in the
mockup's own header comment.

**Top pick**: the single opportunity in the currently-loaded list with the
highest `hardToFillScore` (rows with no score are never eligible). Not
global across the full dataset, not weighted by anything else. Labeled in
its tooltip as exactly that ("highest hard-to-fill score in this list"), not
as anything stronger.

**A real blocker found while implementing**: `Opportunity` has no structured
day-count field. The only place an actual `days_open` integer exists today is
embedded in backend-built reason strings (e.g. `"open 24 days"`). Backend
changes were out of scope for this task, so `extractDaysOpen()` regex-parses
that value out of `reasons`/`hardToFillReasons` and returns `undefined` when
no reason names it. Age badge, spread badge, and the stale callout all
degrade to "not shown" rather than guessing a number when this extraction
fails — consistent with "no invented metrics."

**Sort default**: hard-to-fill rows first, then highest confidence, then
highest hard-to-fill score as a tiebreaker. This replaces the prior behavior
of trusting the backend's confidence-descending order outright (S-04) — rank
numbers now reflect this combined client-side priority.

## What this rests on

That Ali's original design intent for "spread potential" is adequately
captured by a simple two-input threshold rule, and that re-ranking by
hard-to-fill status ahead of raw confidence is the ordering he actually
wants sales reps to see first. Both are our best guess under time pressure,
not his answer.

## What would make this wrong

If Ali specifies different thresholds, wants `role_family` folded into the
spread formula (the mockup's own JS prototype does this; the task's text
formula does not — we followed the task's simpler, explicitly-approved
formula), wants "top pick" to consider anything beyond hard-to-fill score, or
objects to `days_open` being parsed out of free text instead of coming from
a real backend field. If any of that changes, the fix is confined to the
three small functions this decision names (`computeSpreadPotential`,
`findTopPick`, `extractDaysOpen`) plus `sortOpportunities` — nothing else in
the codebase reads these values directly.
