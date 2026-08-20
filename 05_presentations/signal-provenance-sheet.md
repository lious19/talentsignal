# Signal provenance sheet — where each opportunity-score input actually comes from

**Date:** 2026-08-28 · **Author:** Megan (drafted with Cowork) · **Status:** draft for Ali

**Purpose.** For every number the platform puts on an opportunity, name: what it measures, the
exact data field it reads, where that field comes from **today**, where it will come from once
**real ingestion** lands (R5), and the config/decision that owns its weight. Honest headline:
**today every opportunity input traces to a mocked or synthetic feed. The scoring math is real,
transparent, and version-stamped — the underlying data is not yet real.**

## The single seam all opportunity signals flow through
Every opportunity-level signal derives from one `MarketSignal`:
`{ source, externalId, company, title, daysOpen, isRepost, hasSalaryRange }`, produced by a
`MarketSignalProvider` (the adapter seam).
- **Today:** `MockJobBoardProvider` (2 fixed signals — a recruiter + a data analyst) or
  `SeedJobBoardProvider` (synthetic bulk, load-test only).
- **Real (R5):** the Greenhouse + Lever connectors (S-21) plug into the **same** seam — one
  wiring line in `server.ts`, no change to any scorer. **Provenance changes at the adapter and
  nowhere else.**

## 1) Confidence score — "is this posting real evidence of hidden hiring demand?"
`scoreSignal()` / `confidenceConfig.ts` · decision 007 · version `confidence-007-v1`

| Factor | What it measures | Field it reads | Source today | Source when real (R5) | Weight (PROPOSED) |
|---|---|---|---|---|---|
| baseScore | a posting exists at all = weak evidence of hiring | constant | — | — | 0.20 |
| daysOpen | how long open (older → more likely unmet), capped 30 | `MarketSignal.daysOpen` | mock/seed field | **computed by tracking a posting over time (S-22)**, not a single API field | 0.32 |
| repostedRole | the role was re-advertised (harder / unmet) | `MarketSignal.isRepost` | mock/seed field | **derived from diffing postings over time (S-22)** | 0.32 |
| missingSalaryRange | no salary listed (weak demand signal) | `!MarketSignal.hasSalaryRange` | mock/seed field | real posting's salary field | 0.16 |

Output: a 0–1 score + per-factor weight/value/contribution + plain reasons.

## 2) Hard-to-fill score — "is this role type hard to source candidates for?"
`hardToFillScore()` / `hardToFillConfig.ts` · decision 026 · version `hard-to-fill-026-v1` · badge threshold **0.50**

| Factor | What it measures | Field it reads | Source today | Source when real (R5) | Weight (PROPOSED) |
|---|---|---|---|---|---|
| roleScarcity | title matches a hand-picked scarce-role keyword list (data analyst, AI architect, ML engineer, cybersecurity, cloud architect, …) | substring match on `MarketSignal.title` | mock/seed title | real posting title, and eventually a **real role-family taxonomy (S-23)** replacing the keyword list | 0.60 |
| daysOpen | reused reinforcer, capped 30 | `MarketSignal.daysOpen` | mock/seed field | longitudinal tracking (S-22) | 0.20 |
| repostedRole | reused reinforcer | `MarketSignal.isRepost` | mock/seed field | longitudinal tracking (S-22) | 0.20 |

## 3) Hard-to-fill → student match (HF-3)
`matchScore()` / `roleSkillsConfig.ts` · decisions 011 + 027 · advisory only

| Input | What it measures | Where it reads | Source today | Source when real (R5) | Weight |
|---|---|---|---|---|---|
| role requirements | skills a hard-to-fill role needs | opportunity `title` → **role→skills map (PROPOSED, 027)** → skill list | derived from the title via a static map (the signal carries no skills) | ideally **real job-description requirements** from the ATS connector (S-21), replacing the static map | — |
| candidate skills / experience | the student's fit | `candidates.skills`, `candidates.experience` | internal candidate records (manually entered / seeded) | same (candidate data is internal, not a market signal) | skills 0.70 / experience 0.30 |

Match = cosine/Ochiai skills-overlap × a bounded experience bonus; skills always dominate.

## Honest provenance caveats (the whole point of this sheet)
1. **All opportunity inputs today trace to a mock/synthetic feed.** Real provenance arrives with
   R5 (S-21 Greenhouse + Lever). The scoring is real; the data is not yet.
2. **`daysOpen` and `isRepost` are the biggest gap.** The mock hands them to us directly, but for
   real postings neither is a single API field — both require observing a posting over time
   (**S-22 longitudinal diffing**). Their real source is "computed from our own tracking," not
   "read from the provider."
3. **Every weight, the role-keyword list, and the role→skills map are PROPOSED, not measured**
   (decisions 007, 026, 027, 011). **S-25** (validate the hardness score against observed
   time-to-fill) is where they would become evidence-based.
4. **Candidate skills/experience are internal**, not a market signal — provenance is "whatever
   the recruiter entered."

## What changes when real ingestion lands (R5)
Only the adapter. **S-21** supplies real `MarketSignal`s (Greenhouse/Lever); **S-22** computes
real `daysOpen`/`isRepost` by diffing; **S-23** provides a real role taxonomy (replacing the
keyword list); **S-25** measures the weights against real time-to-fill. No scorer, route, or UI
changes — the seam was built for exactly this.
