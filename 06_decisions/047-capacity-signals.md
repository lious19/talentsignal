# 047 — Capacity signals (H-1B LCA, federal awards, SEC Form D) — S-24

**Date:** 2026-09-09
**Story:** S-24
**Requirement:** Ali's Basecamp ticket — difficulty says a role is hard to fill; capacity
says the employer can and will pay someone else to fill it. Three public sources onto the
S-21 adapter pattern: H-1B LCA disclosure data (strongest, role-specific, legally
binding), federal contract awards (period-of-performance start date), SEC Form D
(date of first sale, leads hiring by ~a quarter). Due 2026-09-16.
**Decided by:** Megan, from a plan-mode research pass (`05_presentations/S-24-plan.md`)
and a real, targeted Step 0 spot-check (`05_presentations/S-24-exploration.md`).

## Scope correction: "~1000 companies" doesn't exist in this dataset
The ticket frames match-rate feasibility against "232 GH + 763 Lever = ~1000 companies."
That's wrong. `GREENHOUSE_BOARDS=gitlab` and `LEVER_COMPANIES=gopuff` in this repo's
`.env` mean those 995 rows are 995 **requisitions** from exactly **2 real companies**
(GitLab, gopuff) — seed-job-board rows have fictional company names and can never match
real government data. This isn't a volume-matching problem at current scale; it's binary
per company. Every number below is honest about that.

## Decision A — company matching algorithm
**Chosen: token-Jaccard (after normalizing and stripping legal-entity suffixes) as the
continuous base score, plus a small hand-seeded alias table for real, confirmed
variants.** Considered and rejected: exact-match-after-normalization (binary, no natural
confidence score); Jaro-Winkler alone (fails the exact case that matters — a brand name
vs. its real legal filer name shares no common prefix); a general entity-resolution
service (real cost, and Step 0 only surfaced 2 real companies to resolve against, so a
paid API is overkill relative to what's actually needed today).

The alias table (`backend/src/matching/companyMatchConfig.ts`) is seeded with the exact
real strings Step 0 found filed under GitLab in federal award data — `"gitlab inc"`,
`"gitlab b v"` — not invented examples. An alias hit is forced to `score: 1, basis:
"alias"`.

**The stopword list has to be international, not just US suffixes — proven necessary by
real data, not a hypothetical.** Naive token-Jaccard on `"GitLab"` vs. the real
`"GITLAB B.V."` (an actual federal-award recipient name) scores 0.33 — below Decision B's
0.5 drop line — unless `"b v"` strips the same way `"inc"` does. Without the
international suffix list, this real match would have been silently lost. Pinned by
`companyMatch.test.ts`'s exact case.

## Decision B — match-confidence thresholds
- **≥0.85, or an alias hit (forced 1.0) → "high-confidence."** Full contribution.
- **0.5–0.85 → "low-confidence."** Shown explicitly, contribution *dampened by the
  confidence value itself* (a 0.6-confidence match contributes 60% of a full hit) rather
  than a hard in/out cutoff — this is what makes acceptance criterion 3 ("surfaced as
  low-confidence, not silently dropped or trusted") concretely true.
- **<0.5 → dropped.** No factor evidence exposed at all — below 0.5 a match is more
  likely wrong than right, and showing it (even as "low-confidence") would itself be
  presenting a probably-wrong guess as if it were real evidence.

## Decision C — factor shape, weight, and the recency gate
**One composite `capacitySignal` factor**, not three separate ones. LCA is role-specific
(SOC code/job title), but federal awards and Form D are structurally company-level only —
neither carries any occupation data at all. A single composite with a per-source strength
multiplier avoids needing three separate weight budgets for evidence of very different
granularity:

```
contribution = weight * matchConfidence * sourceStrength * recencyGate
```

`sourceStrength`: LCA 1.0 (strongest — role-specific, legally binding), federal awards
0.6, Form D 0.5 (weakest — no occupation data, and in this dataset structurally
ineligible for our one public company). Company-level sources (awards/Form D) apply
their contribution to *every* open requisition at a matched company; this is stated
plainly in the rationale so a reader never mistakes it for role-specific evidence the
way an LCA match is.

**Recency gate (Megan's instruction): any capacity signal older than `recencyMonths`
(24, a named constant in `CAPACITY_SIGNAL_CONFIG`) contributes exactly 0.** A decade-old
contract award is not 2026 hiring intent. Critically, a real match outside the window
**still reports its real basis, matched employer name, and event date** — the
contribution zeroes, but the evidence stays visible, naming the real date and why it
doesn't count. It is never silently collapsed into "no match ever existed" — that would
hide a real, if stale, signal behind exactly the same blank the codebase already uses
for "nothing was ever found," which fails the "no hidden inputs" standard 046 set.

**Reweight, PROPOSED — this is a real dilution of S-23's own framing, flagged
explicitly, not a fait accompli.** `capacitySignal` claims 0.20 of the total weight
budget (the story's own suggested number); the other three shrink proportionally to
keep the sum at 1.0: `roleScarcity` 0.6→0.48, `daysOpen`/`repostedRole` 0.2→0.16 each.
**S-23 (decision 046) justified roleScarcity's 0.6 explicitly as "dominant... the one
genuinely new signal" — dropping it to 0.48 measurably dilutes that framing.** This is
Megan's proposal, pending Ali's sign-off, exactly like every other weight in this
codebase; if Ali wants a different split (e.g. capacitySignal at a smaller weight, or
roleScarcity protected at 0.6 with the other two absorbing the full cut), that's a
one-line change in `hardToFillConfig.ts`, nothing structural.

**Version bump: `hard-to-fill-026-v2` → `hard-to-fill-026-v3`.** Same discipline as the
v1→v2 bump — weights *and* what the score composition means both change, so every
stored score needs to be traceable to which meaning produced it.

**`hardToFillThreshold` (0.50): left unchanged.** The four weights still sum to 1.0, so
the threshold's meaning doesn't mechanically shift. Given Step 0's real match count, it
may rarely (if ever) be capacitySignal alone that tips a score across this line today —
that's fine; the rationale still names the evidence per criterion 1 even when it doesn't
flip the badge.

## Real bug found and fixed while wiring this in
`computeFamilyScarcity()` (S-23) was fully built and unit-tested but **never actually
called from the live `/hidden-demand/analyze` path** — grepped the whole backend before
this story; its only caller was its own test file. `roleScarcity` could never reach
"measured" through real ingestion, only through a direct unit test passing a synthetic
lookup. This wasn't part of S-24's scope, but wiring `capacitySignalLookup` into the same
call site required touching the exact same code, and shipping the new factor properly
wired while leaving the old one silently broken would have been worse than fixing both.
Both `computeFamilyScarcity()` and the new `computeCapacitySignalLookup()` are now
computed once per `upsertBatch()` run and threaded through to every signal scored in that
run — the design 046 already described, now actually true in the live path.

## Step 0 outcome — honest, current-data result
Real spot-check (`05_presentations/S-24-exploration.md`), one representative recent
file/quarter per source, targeted at the 2 real companies in this dataset:

| Source | GitLab | gopuff |
|---|---|---|
| H-1B LCA (FY2026 Q1) | 0 | 0 |
| Federal awards (all-time) | 4 real awards, **all 2015–2017** | 0 |
| SEC Form D (2026 Q2) | 0 (structural — public co) | 0 |

**All 4 real GitLab federal awards fall outside the 24-month recency window** —
`resolveCapacitySignal()` correctly zeroes their contribution while still reporting
`basis: "measured"` and the real 2015–2017 dates in the rationale (proven by
`hardToFillScore.test.ts`'s recency-exclusion case).

**Framing: this ships real, tested, working infrastructure. Against the current
2-company universe, it validates zero *active* capacity signals — not because the
mechanism is broken, but because the real data genuinely doesn't clear the bar this
story set (recency, role/company match, source eligibility).** Every one of those "zero"
outcomes is a real, verified query result, not an untested code path — the federal-award
provider genuinely fetched, matched, and persisted 4 real rows; the recency gate
genuinely zeroed them. This is expected to activate as the company universe grows beyond
2 real employers — nothing here is scoped to GitLab/gopuff specifically.

## Known limits — spelled out, not hidden
- **LCA has no role-level targeting yet.** The story's acceptance criterion framing
  ("raises the hardness of a *matching* open requisition") is, today, company-level like
  the other two sources — an LCA match bumps every open req at a matched company, not
  specifically the requisition whose title/SOC code the LCA filing actually names. LCA's
  `roleTitle`/`socCode` fields are captured and persisted (available for a future
  role-overlap refinement) but not yet used to narrow which requisition gets the bump.
  Deliberately not built now — the exact `contribution = weight * matchConfidence *
  sourceStrength * recencyGate` formula Megan specified has no role-overlap term, and
  adding one unasked would have been scope creep, not a requested feature.
- **LCA's raw-persist-before-parse deviation (decision 040).** At ~1M rows per quarter
  (73MB xlsx, confirmed in Step 0), persisting every row raw before filtering is
  impractical for an app whose only real use is checking a handful of known company
  names. `LcaProvider` prefilters during the stream and only persists rows that pass a
  cheap company check — a deliberate, documented deviation from decision 040's "raw
  persisted before parsing" discipline, not a silent shortcut.
- **Federal awards need a second API call per matched award.** The search endpoint's own
  `Period of Performance Start Date` field returns `null` for every real result (Step 0
  confirmed this against live data) — the real value only exists on the per-award detail
  endpoint. Batched via `Promise.all`, bounded by the small (≤10) match count per company.
- **Single-quarter/one-time coverage per ingestion run.** LCA and Form D both fetch
  whichever quarter is currently live at the fixed URL this story hardcodes
  (`LCA_Disclosure_Data_FY2026_Q1.xlsx`, `2026q2_d.zip`) — a real gap once those quarters
  age out and a newer one publishes. Capacity ingestion is a manual batch job
  (`npm run ingest:capacity-once`), not on a schedule; a future story would need to
  parameterize the URL by current quarter and/or add a scheduler, same posture S-21 took
  before deferring a cron wrapper.
- **gopuff's zero is not proof of absence, only of this-quarter absence.** LCA and Form D
  were each checked against one recent quarter/file, not full history — a real filing in
  a different quarter wouldn't be caught by this pass.

## What this rests on
That Step 0's single-quarter/all-time spot-check for federal awards is representative
enough to design against, and that GitLab/gopuff's real behavior (0/0/4-stale) is the
honest current state, not an artifact of a bad query — verified directly: the
`recipient_search_text` vs. `keywords` gotcha was caught and fixed by manually inspecting
real API responses, not assumed from documentation.

## What would make this wrong
If Ali reframes the story's success bar away from "raises a matching requisition's
hardness today" toward "ships correct, tested infrastructure for when the company
universe grows" (the framing Megan is bringing to the 2pm meeting), this decision holds
as-is. If Ali instead wants LCA's role/SOC-level targeting built now regardless of the
2-company data reality, or wants the reweight reversed (roleScarcity protected at 0.6),
those are both small, additive changes — `resolveRoleScarcity`'s existing family/SOC
matching pattern in `hardToFillScore.ts` and a one-line weight edit in
`hardToFillConfig.ts`, respectively — nothing here architecturally blocks either.
