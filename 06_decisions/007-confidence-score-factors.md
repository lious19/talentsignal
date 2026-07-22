# 007 — Confidence score factors and weights (S-03)

**Date:** 2026-07-22
**Story:** S-03
**Requirement:** REQ-001, REQ-019
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question
S-03's demo needs a confidence score on every opportunity, but no one has told
us what produces it. Scoring weights are a business decision (CLAUDE.md rule
4), not something to invent silently. Note: REQ-003's full "Opportunity
Scoring — 0..1 from transparent factors" system is S-07's job. This is
deliberately a minimal, first-pass heuristic to prove the pipe works end to
end, not the final scoring system.

## Options considered
1. Ship with no config at all — hard-code numbers inline in the scoring
   function.
2. One exported config object, marked PROPOSED, holding every weight and
   threshold, with the scoring function reading only from it.

## What we chose, and why
Option 2. `backend/src/scoring/confidenceConfig.ts` is the single source of
every number the score depends on. When Ali answers, updating this file is a
one-line change — nothing else in the codebase reads a raw weight directly.

Proposed factors, each defensible in one sentence:

- **Base score (0.20)** — any confirmed posting is already evidence a company
  is spending money to hire. A first draft of this scored a brand-new,
  non-reposted, salary-disclosed posting as 0.0 — that's wrong, since it
  claims zero evidence exists when a real posting does exist. The base score
  fixes that.
- **Reposted role (weight 0.32)** — a company reposting the same title
  signals they already tried and failed to fill it once. Stronger evidence of
  unmet hiring need than a single fresh posting.
- **Days open, capped at 30 (weight 0.32)** — the longer a role sits open,
  the harder it's proving to fill internally — exactly when a staffing
  agency's pitch lands. Capped so a role open 200 days doesn't dominate more
  than one open 30.
- **Missing/vague salary range (weight 0.16)** — postings without a
  disclosed range correlate with less structured hiring processes. A real
  but weaker signal than the other two, hence the lower weight.

0.20 + 0.32 + 0.32 + 0.16 = 1.00, so the score is always in [0, 1] by
construction — no clamping needed.

Every rendered opportunity shows the plain-English reasons behind its score
(e.g. "reposted role, open 24 days, no salary range"), not just the number —
this is the trust scenario ("no black-box assertions") applied literally:
since the score is a transparent weighted sum, showing the contributions
costs nothing extra.

## What this rests on
That these three factors, at these weights, are what a staffing salesperson
would actually recognize as hidden-demand signals. This is our best guess,
not Ali's answer.

## What would make this wrong
If Ali specifies different factors, different weights, or a different
formula shape entirely (e.g. non-linear, or factors we haven't considered —
company headcount growth, funding events, etc.), this file changes and the
rest of the codebase is unaffected. If Ali says the base score shouldn't
exist — that a posting with no other signal should score at or near zero —
that's a real disagreement to have explicitly, not something to guess past.
