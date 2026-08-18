# HF-1 — Hard-to-fill indicator & score

**Status:** Built & verified (commit `2663411`). 17 unit tests pass
(`backend/tests/hardToFillScore.test.ts`). Role list / weights / threshold are
**PROPOSED**, pending Ali (`06_decisions/026`). Consumed by HF-2.

## What it does (plain English)
Answers a question the platform couldn't before: "how hard is this role to fill?"
Given a market signal (a job posting), `hardToFillScore(signal)` returns a 0–1 score
with a factor breakdown and plain-English reasons. It is a **separate, parallel
scorer** to the confidence score — a different question, not a change to how confidence
works.

## Why a second scorer, not a new confidence factor
Confidence answers "is this posting real evidence of hiring demand?" Hard-to-fill
answers "is this role type hard to source candidates for?" — two things a manager
reasons about separately. Folding them together would break "one place per score"
(S-07) and make `scoreSignal()` do two jobs. So `hardToFillScore()` is independent;
`scoreSignal()` / `confidenceConfig.ts` are untouched (`06_decisions/026`).

## The indicators (all in one config, `hardToFillConfig.ts`)
- **roleScarcity (0.60)** — the one genuinely new signal: does the title match a
  hand-picked list of scarce role types (data analyst, data scientist, AI architect,
  AI/ML engineer, data engineer, cybersecurity, security engineer, cloud architect).
  It dominates on purpose, or a merely old/reposted generic role could read as "hard
  to fill."
- **daysOpen (0.20)** — reused from confidence as a difficulty *reinforcer*, capped at
  30 days.
- **repostedRole (0.20)** — reused reinforcer, weighted equally to daysOpen.

No base score: a generic, fresh, non-reposted role scores exactly **0**.
0.60 + 0.20 + 0.20 = 1.0, so the score is always in [0, 1] by construction. The
`hardToFillThreshold` (0.50, used by HF-2 to badge) sits above what the two reinforcers
can reach alone (0.40), so crossing it requires a genuine role-type match.

## The assumption it rests on
That these role types, at these weights, are what a staffing salesperson would
recognize as hard-to-source. This is our best guess, **not Ali's answer** — same
posture as decision 007's confidence weights.

## What would make it wrong
A different role list, weights, threshold, or formula from Ali → a one-line edit to
`hardToFillConfig.ts`, nothing else changes. Substring matching is punctuation-sensitive
by design ("Sr. Data-Analyst" will NOT match "data analyst") — a documented limitation;
fix `matchesScarceRole` if Ali wants fuzzy / word-boundary matching.

## Trust scenario (the loop stop)
The score is never a bare number: it always renders each indicator's weight, value, and
contribution, plus plain reasons — exactly like the confidence score. Even zero-value
factors are shown (a visible zero is more auditable than an omitted row).

## Tests (17, `hardToFillScore.test.ts`)
Generic fresh role = exactly 0; in-demand + old + reposted = 1.0; case-insensitive and
substring keyword matching; generic title matches nothing; repost adds its weight;
daysOpen saturates at 30; stays within [0, 1]; idempotent; all three factors always
present in fixed order even at zero; weights reported; contributions sum to the score;
version stamped; graceful on empty / whitespace / 2000-char titles; and it documents the
punctuation-matching limitation explicitly.

## Status / caveat for the demo
HF-1 is a pure scoring function with no UI of its own — HF-2 is what surfaces it on the
Opportunities screen. **Demo gap:** the shipped mock feed's single signal is a generic
"Senior Recruiter" (scores 0.36 → not flagged), so nothing visibly hard-to-fill appears
until a scarce-role example is added to the feed.
