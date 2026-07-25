# 011 — Match score: combining skills overlap with experience (S-06)

**Date:** 2026-07-25
**Story:** S-06
**Requirement:** REQ-002, REQ-020
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

Ali's build note prescribes the *method* — cosine-style similarity on skills
overlap — so that part isn't open. But the note also says "skills/experience
overlap," and there's no job-side "required years of experience" column to
overlap experience against (`job_openings` has no such field;
`candidates.experience` is a standalone integer). So experience has to enter
the fit score some other way, and *how* it combines with the skills score
into one number is a real judgment call, not something Ali specified. A
second, smaller question rode along: whether `candidates.availability`
(free-text, no defined vocabulary) should filter the candidate pool at all.

## Options considered

For combining skills and experience into `fitScore`:

1. **Pure additive** — `fitScore = weights.skills*skillsScore +
   weights.experience*experienceScore`. Simple, but has a real bug: with
   weights 0.7/0.3, a candidate with **zero** matching skills but 10 years
   of experience scores `0.30`, which outranks a candidate with a real (if
   weak) skill match and little experience (e.g. `0.17`). For a
   skills-matching tool, letting experience alone lift a totally-unrelated
   candidate above someone who shares a skill is the wrong ranking.
2. **Hard gate** — experience only counts if `skillsScore > 0`. Fixes the
   pathological case, but creates a cliff: a candidate with a single,
   nearly-irrelevant skill match (`skillsScore = 0.02`) unlocks the entire
   experience weight, same as a candidate with a strong match.
   Discontinuous, hard to defend as "graduated."
3. **Multiplicative** — `fitScore = skillsScore * (weights.skills +
   weights.experience * experienceScore)`. Lets `skillsScore` scale the
   whole formula, so experience is a bonus proportional to how relevant the
   skill match already is, not an independent term.

For `availability`:

1. Invent a filter rule on the free-text field (e.g. exclude a literal
   `"unavailable"` value).
2. Accept an optional caller-supplied filter parameter.
3. Exclude it from the score (per Ali's note) and treat it as display-only —
   no filtering — leaving the actual filter semantics as an open question.

## What we chose, and why

**Combination: option 3 (multiplicative).** It guarantees `skillsScore = 0 →
fitScore = 0` no matter how much experience a candidate has — a candidate
with no shared skills can never outrank one with any real overlap — while
still scaling smoothly rather than gating on/off.

```ts
// backend/src/matching/matchConfig.ts
export const MATCH_CONFIG = {
  weights: { skills: 0.7, experience: 0.3 },
  experienceSaturationYears: 10,
};
```

`experienceScore = min(experience, 10) / 10` (capped, same shape as S-03's
`daysOpenSaturationThreshold`, and for the same reason: someone with 30
years shouldn't dominate someone with 10).

Worked example: candidate skills `["react","node","sql","python"]` (4) vs.
job requirements `["react","typescript","sql"]` (3) → intersection 2 →
`skillsScore = 2/sqrt(4*3) = 0.577`. At 6 years experience,
`experienceScore = 0.6`. `skillsContribution = 0.577*0.7 = 0.404`,
`experienceContribution = 0.577*0.3*0.6 = 0.104`, `fitScore = 0.508`.

A direct, worth-naming consequence of this shape: with these weights,
`experienceContribution` can never exceed `skillsContribution * (0.3/0.7) ≈
0.43x` for any candidate with a nonzero skill match — skills always
contributes more than experience to a nonzero score, by construction. So a
rank is never "driven by experience" outweighing skills; experience can only
ever add a bounded boost on top of a real skill match, or contribute
nothing. `matchScore.ts`'s `rankDriver` field reflects this honestly
(`"no-skill-match" | "skills-only" | "skills-plus-experience"`) rather than
implying a contest experience can't structurally win.

**Availability: option 3 (display-only, no filtering).**
`candidates.availability` is free text with no defined vocabulary (could be
"available now", "2 weeks notice", null, etc.) — inventing filter semantics
on undefined values would be exactly the "silent assumption" CLAUDE.md rule
4 forbids. It's excluded from the score (per Ali's note) and returned on
every ranked candidate so a recruiter sees it and decides — which also fits
this story's own trust theme (the platform shows, the human decides).

## What this rests on

That a candidate with zero shared skills should never be ranked above one
with a real overlap, regardless of experience — a judgment call about what
"fit" means for a staffing tool, not something Ali stated explicitly. Also
rests on 10 years being a reasonable experience saturation point (same kind
of guess as S-03's `daysOpenSaturationThreshold`, not Ali's answer).

## What would make this wrong

If Ali says experience should be able to outweigh a weak skill match after
all (e.g. a very senior candidate is worth surfacing even with a thin skills
overlap), the multiplicative shape would need to change — likely back to a
hard gate with a minimum-overlap floor, or a different weight split
entirely. If Ali defines what values `candidates.availability` can take
(e.g. an enum), the display-only choice above should become a real filter
instead, and this decision should be revisited. Both weights (0.7/0.3) and
the saturation cap (10 years) are proposals, not conclusions — see the open
question below.
