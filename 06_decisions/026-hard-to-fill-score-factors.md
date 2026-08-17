# 026 — Hard-to-fill score factors, weights, and threshold (HF-1)

**Date:** 2026-08-17
**Story:** HF-1
**Requirement:** TBD — not yet mapped to a Basecamp REQ; this build-out comes from
Ali's Aug 17 meeting notes (`00_scope/stories/BUILDOUT-hard-to-fill.md`), not a numbered
story
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question
Ali asked for a way to spot roles that are "not easy to fill" (his examples: data
analysts, AI architects, "anything along that realm") and give sales that "inside
scoop." No one has told us which role types actually count, or how much each indicator
should weigh. Scoring weights are a business decision (CLAUDE.md rule 4), not something
to invent silently — same posture as decision 007's confidence weights.

## Options considered
1. Fold a `roleScarcity` factor into the existing `confidenceScore.ts`/
   `CONFIDENCE_CONFIG` as a fourth weighted factor.
2. A wholly separate `hardToFillConfig.ts` + `hardToFillScore.ts`, reusing `daysOpen`
   and `repostedRole` as reinforcers alongside a new `roleScarcity` indicator — same
   transparent-weighted-sum shape, independent config, independent version.

## What we chose, and why
Option 2. Confidence and hard-to-fill answer different questions: "is this posting real
evidence of unmet hiring demand" vs. "is this specific role type hard to source
candidates for." Folding them together would blur two signals a manager needs to reason
about separately, and would break "one place per score" by making `scoreSignal()` do two
jobs at once — the exact anti-pattern S-07's build note called out ("do NOT build a
third scorer"). `hardToFillScore()` is a second, independent scorer; `scoreSignal()` and
`confidenceConfig.ts` are untouched by this decision.

Proposed factors, each defensible in one sentence:

- **Role scarcity (weight 0.60)** — the one genuinely new signal this story adds; it
  must dominate the formula, or a generic role that's simply old and reposted could
  still register as "hard to fill" on duration/repost alone, which would misrepresent
  what the score means.
- **Days open, capped at 30 (weight 0.20)** — reused from confidence as a difficulty
  *reinforcer*: a role sitting open a while is corroborating evidence of fill
  difficulty, but duration alone (a slow-moving but easy-to-fill role) shouldn't be
  enough to call it hard-to-fill on its own.
- **Reposted role (weight 0.20)** — reused from confidence as the other reinforcer,
  weighted equally to days-open since neither is role-type evidence by itself, and
  there's no basis to prefer one reinforcer over the other for this specific question.

0.60 + 0.20 + 0.20 = 1.00, so the score is always in [0, 1] by construction — no
clamping needed. Unlike `CONFIDENCE_CONFIG`, there is deliberately **no base score**: a
generic, fresh, non-reposted role must score exactly 0, per HF-1's "generic role scores
low" acceptance criteria. (Confidence's base score exists because a posting's mere
existence is evidence of hiring; hard-to-fill has no equivalent baseline — a role isn't
inherently hard to fill just because it exists.)

Proposed role keyword list — plain-text, case-insensitive substring match against
`MarketSignal.title`, each entry a role type with a recognized talent-scarcity gap in
the staffing market: data analyst, data scientist, AI architect, AI engineer, ML
engineer, machine learning engineer, data engineer, cybersecurity, security engineer,
cloud architect.

Proposed `hardToFillThreshold: 0.50` — for a later story (HF-2) to classify a score as
"hard to fill." Set above what the two reinforcers can reach alone (0.20 + 0.20 = 0.40),
so crossing it mechanically requires a genuine `roleScarcity` match, not just an old
repost. Defined now, in this config, even though nothing reads it until HF-2 wires up
the badge — keeping every number this scorer depends on in the one config file.

## What this rests on
That these role types, at these weights, are what a staffing salesperson would actually
recognize as hard-to-source — this is our best guess, not Ali's answer, same caveat
decision 007 carried.

Two interpretation calls made explicitly, not guessed past silently:
1. **"A threshold" (singular) vs. two thresholds.** The build note asks for "a
   threshold," but the formula mechanically needs two different ones: a saturation point
   for the days-open ratio (`daysOpenSaturationThreshold: 30`, mirroring confidence's
   existing value) and a classification cutoff for "counts as hard-to-fill"
   (`hardToFillThreshold: 0.50`, the one intended for HF-2). Both are proposed here.
2. **No canonical role-type vocabulary.** Decision 025 already flagged that this schema
   has no industry column or canonical role-type taxonomy to build segmentation on. The
   same gap applies here — `roleKeywords` is a flat, hand-picked list matched by plain
   substring, not a real taxonomy. It inherits decision 025's caveat rather than
   pretending to be more rigorous than the schema allows.

## What would make this wrong
If Ali specifies a different role list, different weights, a different threshold, or a
different formula shape entirely, this file changes and `hardToFillScore.ts` (which
reads only from it) is unaffected elsewhere in the codebase. If Ali wants fuzzy or
word-boundary matching instead of plain substring matching — today's version won't match
"Sr. Data-Analyst" against the "data analyst" keyword, since substring matching is
punctuation-sensitive — that's a real gap to fix in `matchesScarceRole`, not something to
silently patch around. If Ali says role scarcity shouldn't dominate the formula, or that
a generic role should carry some nonzero baseline after all, that's a real disagreement
to have explicitly, same as decision 007's base-score caveat.
