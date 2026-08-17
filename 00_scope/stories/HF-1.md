# HF-1 — Hard-to-Fill indicator & score
**Agent:** ScoringAgent · **Fulfills:** TBD — not yet mapped to a Basecamp REQ, this
build-out comes from Ali's Aug 17 meeting notes, not a numbered Basecamp story · **Due:** TBD
**Basecamp:** TBD — no Basecamp item exists yet for this build-out track
**Captured from Ali's Aug 17 meeting, via `00_scope/stories/BUILDOUT-hard-to-fill.md`.**

## Story
As an agency manager, I want each opportunity scored for how hard its role is to fill,
so I can spot the high-value openings worth targeting students for.

## Slice
`hardToFillScore(signal)` → a separate, explainable fill-difficulty score behind the
ScoringAgent boundary.

## Acceptance (Gherkin)
**Hard-to-fill is scored and explained**
- Given a signal for an in-demand role (e.g. a data analyst) that has been open a while
- When it is scored
- Then it returns a high hard-to-fill score **with a factor breakdown and plain-English
  reasons**, never a bare flag

**🛡 TRUST — the score is inspectable, not a black box**
- Given any hard-to-fill score
- When it renders
- Then it shows each indicator's weight, value, and contribution, exactly like the
  confidence score does

## Build note (Ali's words, via meeting notes)
> Spot a "position that is not easy to fill" (examples: "data analysts, AI architects,
> anything along that realm"), give that "inside scoop" to the Boston sales team so they
> can decide "which students to submit" resumes for, and "build out these different
> indicators and tie it to your current system." Most of the existing build stays and is
> reused.

New `hardToFillConfig.ts` (PROPOSED, pending Ali — mirrors the header comment on
`confidenceConfig.ts`): a hard-to-fill role-type keyword list (data analyst, AI
architect, ML engineer, data engineer, cybersecurity, …), indicator weights, and a
threshold. New `hardToFillScore()` mirroring `confidenceScore.ts` (transparent weighted
sum, `factors[]`, `reasons[]`, `version`). Indicators: **roleScarcity** (title matches
the hard-to-fill list — the new signal), plus **daysOpen** and **repostedRole** reused
as difficulty reinforcers. Heuristic-first, swappable for a model later. Do NOT touch
`scoreSignal()` — one place per score.

## Trust (TBI)
The hard-to-fill score is a transparent weighted sum, never a bare flag: every rendered
score carries its full factor breakdown (weight, value, contribution per indicator) and
plain-English reasons, identical in spirit to the confidence score's trust scenario
(decision 007). It is a second, independent score — `scoreSignal()`/`confidenceScore.ts`
are not modified by this story.

## Decisions to flag
The role list, the indicator weights, the threshold — all PROPOSED pending Ali, logged
in `06_decisions/026-hard-to-fill-score-factors.md` (same pattern as decision 007).

## Tests
An in-demand role open a while scores high; a generic role scores low; the factor
breakdown is always present (even zero-value indicators); empty/short/edge inputs are
graceful.
