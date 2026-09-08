# 046 — Measured role-family scarcity (S-23)

**Date:** 2026-09-07
**Story:** S-23
**Requirement:** upgrade HF-1's dominant factor (`roleScarcity`, weight 0.60) from
decision 026's curated keyword list to measured evidence, per Ali's Basecamp ticket
("roleScarcity ... currently fires on a hand-curated list ... What it lacks is
evidence"), due 2026-09-09.
**Decided by:** Megan, reviewed live with Ali's approval at each step below.

## The question
`roleScarcity` is 0.60 of the hard-to-fill score and, until this story, fires only on
decision 026's hand-picked list of 10 keywords. Ali asked for it to become measurable:
group titles into role families, measure how long each family's postings actually sit
open, and treat a family running roughly 2x the global median as objectively scarce —
with the curated list staying as an honest fallback, and the rationale always naming
which basis produced a given score.

## Scope correction: "days-to-close" doesn't exist in this schema
The ticket asks for "median observed days-to-close." Neither `raw_requisitions` nor
`opportunities` tracks when a posting closes — there is no `posted_at`/`closed_at`
anywhere. The only real signal is `opportunities.days_open`, an integer snapshot
computed in `computeDiffs.ts` ("still open as of the latest poll," from the posting's
own `openedAt` vs. the latest `fetched_at` — decision 045). This is a genuine proxy
with survivorship bias: a posting that closed quickly and dropped off a board before
being polled again is invisible to it, so `days_open` systematically under-represents
how many roles fill fast. Proceeding on `days_open` throughout this story, named as
such everywhere (rationale strings, the artifact, this doc) — never silently relabeled
"days-to-close."

## Decision A — title-to-family mapping
Three options considered:

1. **Curated keyword→family map** — extend `HARD_TO_FILL_CONFIG.roleKeywords`'s
   existing `.includes()` technique (already accepted in decision 026) into a
   `roleFamilies: Record<familyKey, string[]>` lookup. Zero new dependencies, ships
   inside the deadline, same review posture Ali already approved once.
2. **O*NET SOC code mapping** — a well-defined external taxonomy, but requires
   acquiring/licensing a mapping file and maintaining a crosswalk. Real integration
   cost for a taxonomy far more granular than ~1,040 scrappy staffing-market titles
   need. **Rejected** — overkill relative to what the acceptance criteria actually
   require (splitting Help Desk from Staff ML).
3. **Embedding-based clustering** — needs an external model and network egress.
   **Rejected outright**: directly contradicts CLAUDE.md rule 5 ("heuristic first...
   do not reach for ML"), and adds a live external dependency into a scoring path that
   decisions 041/043 deliberately kept self-contained and synchronous — real demo-day
   flakiness risk for no accuracy gain this dataset's size would actually reward.

**Chose option 1.** Final taxonomy (`hardToFillConfig.ts`'s `roleFamilies`), grounded
in real title strings pulled from the live `opportunities` table
(`05_presentations/S-23-exploration.md`), not invented abstractly:

`engineering-swe`, `ml-ai`, `data-analytics`, `security`, `cloud-infra`, `support-cs`,
`sales-bizdev`, `retail-ops`, plus the implicit `general-other` catch-all.

`data-analytics` and `cloud-infra` were deliberately kept narrow (4 and 6 keywords)
even though their real Greenhouse counts (3 and 4 rows) sit well under the measured
threshold below. Widening them to sweep in unrelated titles (e.g. "Engineering
Manager, Data Foundations," a management title, not a data-analyst/scientist/engineer
role) just to manufacture "measured" status was considered and rejected — that would
be exactly the fabricated-metric failure mode this story exists to replace.

**Precedence bug found and fixed while building this:** classification originally
resolved families by simple object-declaration order, which meant `ml-ai`'s broad
bare-word keyword `"ai"` would have preempted `data-analytics`'s more specific "data
engineer" phrase on a title like "AI Data Engineer" purely because `ml-ai` happened to
be listed first. Fixed with a two-pass rule: any multi-word ("specific") keyword match,
in any family, always wins over any single-word ("broad") keyword match; only when no
specific phrase matches anywhere does a broad token decide, by declaration order.
Pinned by dedicated precedence tests in `classifyFamily.test.ts`.

**Punctuation-sensitivity fix (affects decision 026 too):** decision 026 flagged that
its curated list wouldn't match "Sr. Data-Analyst" against "data analyst" (punctuation-
sensitive substring matching). Fixed here by normalizing both title and keywords —
collapsing runs of non-alphanumeric characters to single spaces — before a word-
boundary substring match. This makes `matchesScarceRole` (the original decision-026
fallback) strictly **more permissive**, never different, for every title that already
matched before this change; a regression test confirms no existing curated match
broke, and one new test confirms "Sr. Data-Analyst" now matches where it used to.

## Decision B — minimum observations for "measured," and the Lever exclusion
**Threshold: 10 observations, computed within Greenhouse only.**

Two things changed from the original framing once Step 0 pulled real numbers
(`05_presentations/S-23-exploration.md`):

**Lever is excluded from every median computation — both per-family and global —
not just pooled with a caveat.** Real numbers from a live ingestion run: Greenhouse's
(GitLab's) median `days_open` is 33 days; Lever's (gopuff's) is **1,169 days**, roughly
35x higher. A sampled Lever `raw_response` shows normal, current-looking job content —
nothing suggesting these are stale, abandoned listings. The far more likely
explanation is that Lever's raw `createdAt` field (what `computeDiffs.ts` uses as
"opened" for Lever, per decision 045) doesn't mean "this posting went live" the way
this scorer assumes — possibly an account- or req-creation date on Lever's own
platform. Publishing a "measured" scarcity claim built on that number would itself be
an invented metric — the exact thing this story replaces decision 026's opinion-based
list to avoid. **Flagged explicitly for revisit in S-24, or whenever Lever's field
semantics are confirmed with a real client integration** — not silently worked
around, and not assumed fixed by this story.

Concretely: `familyScarcity.ts` computes both the per-family and the global median
`days_open` from `source = 'greenhouse'` rows only. A signal is only eligible for the
**measured** basis when its own `source` is on an explicit allowlist (today, just
`["greenhouse"]` — an allowlist, not a Lever-specific blocklist, so a future third
source defaults to ineligible until someone deliberately vets its `days_open`
semantics the way this decision vets, and rejects, Lever's) AND its family has at
least `familyObservationThreshold` (10) real Greenhouse observations. This is a
property of the *signal's own source*, not just the family's aggregate count: even a
Lever-sourced posting in a family that clears 10 Greenhouse observations elsewhere
(e.g. `sales-bizdev`, 38 Greenhouse + 175 Lever rows) never gets a measured value
itself, because its own `days_open` is the unreliable number, not just the family's.

**Real threshold outcome** (one live ingestion run, 232 real Greenhouse + 763 real
Lever rows — see `05_presentations/S-23-exploration.md` for the full breakdown):

| family | Greenhouse count | measured-eligible? |
|---|---|---|
| engineering-swe | 56 | yes |
| ml-ai | 10 | yes (exactly at the threshold) |
| support-cs | 35 | yes |
| sales-bizdev | 38 (of 213 total; 175 Lever excluded) | yes |
| security | 9 | **no — one observation short** |
| cloud-infra | 4 | no |
| data-analytics | 0 (all 3 real rows are Lever) | no |
| retail-ops | 0 (all 530 real rows are Lever) | no, and never can be under this rule |

A family below threshold, or a signal whose own source isn't on the allowlist, falls
back to the original decision-026 curated-keyword check unchanged — with one
exception: the curated fallback is **not** itself source-restricted (it never was),
so a Lever-sourced posting that happens to match a decision-026 keyword still gets
`basis: "curated"` normally.

**`general-other` is explicitly excluded from ever being "measured," even though it
clears the observation threshold.** A full live run against all 995 opportunities
surfaced this directly: `general-other` (the leadership/management catch-all
discussed under "known limits" below) has 80 real Greenhouse rows — comfortably over
10 — so without an explicit exclusion, `familyScarcity.ts` would compute a median for
it and the scorer would treat it as measured. That would directly contradict this
same decision's own reasoning for rejecting a dedicated "leadership" family: a median
blended across an incoherent catch-all bucket is worse than not measuring it at all.
`computeFamilyScarcity`'s query excludes `family_key = 'general-other'` outright, so
it can never appear in the lookup regardless of how large it grows. Covered by an
integration test (`familyScarcity.integration.test.ts`).

## roleScarcity's value: continuous when measured, unchanged weight
`roleScarcity`'s **weight stays 0.60** — only its *value* changes shape:

```
measured:  value = min(1, familyMedianDaysOpen / (2 * globalMedianDaysOpen))
fallback:  value = curated keyword match ? 1 : 0   (identical to pre-S-23 behavior)
```

A family's median exactly at 2x the global median saturates the value at 1.0,
matching the ticket's own "routinely sit twice as long as the median" framing
directly. Because the weight and the [0,1] score range are unchanged, HARD_TO_FILL_-
CONFIG's existing `hardToFillThreshold` (0.50) needed no change.

## Three-state rationale (criterion 3: no hidden inputs)
Every `roleScarcity` factor now carries a `basis: "measured" | "curated" | "none" |
"n/a"` field (`"n/a"` on the other two factors, which have no basis concept). The
persisted reason string names the basis explicitly whenever one applied — and stays
silent when it didn't, matching the convention this factor (and `repostedRole`)
already used before this story for a zero contribution:

- **measured:** `"role scarcity: measured (family 'ml-ai', median 69d vs global
  33d)"` — real example, live scoring run, "Senior Product Designer, AI"
  (`days_open` 167, score 0.8).
- **curated:** `"role scarcity: curated (matched decision-026 keyword)"` — real
  example, live scoring run, "Staff Corporate Security Engineer" (`days_open` 9,
  score 0.66).
- **none / excluded:** no `"role scarcity:"` line at all. This covers both a
  genuine no-match (today's pre-existing behavior, unchanged) and a Lever-sourced
  signal that isn't independently a curated match — chosen over an explicit
  "source excluded" line specifically to stay consistent with how this factor and
  `repostedRole` already handle every other zero-contribution case, rather than
  inventing a fourth, inconsistent convention for this one case.

## Config version bump: `hard-to-fill-026-v1` → `hard-to-fill-026-v2`
Weights and the `[0,1]` score range are unchanged, but `roleScarcity`'s value now
means something new (a measured ratio for eligible Greenhouse families, not just a
curated-list boolean) — every stored score needs to be traceable to which meaning
produced it.

**Backfill does not rescore existing opportunities.** Migration 018 and
`backfill:family-key` populate `opportunities.family_key` for every existing row, but
that is a classification label only — it does not re-run `hardToFillScore()` against
those rows. Old rows keep their original score, reasons, and factor breakdown, still
stamped `hard_to_fill_version: "hard-to-fill-026-v1"`. Only new scoring runs (a fresh
ingestion, or an explicit future rescore story) produce `hard-to-fill-026-v2` results.
No silent mass-rescore.

## Known limits — spelled out, not hidden
- **`ml-ai` sits at exactly the observation threshold (n=10).** A family median this
  small is fragile: one atypical row can move it materially. The real family median
  (69d) is itself partly driven by one such row (see next point) — this is a live,
  visible instance of the threshold's own fragility, not a hypothetical one.
- **`security` is at n=9 — one real Greenhouse posting away from flipping from
  curated to measured.** Worth watching; the threshold is doing real, visible work
  here, not just a nominal gate.
- **Real false positive: "Senior Product Designer, AI" classifies as `ml-ai`.** It
  matches only via the broad bare-word "ai" token (no specific ml-ai phrase fits a
  product-design title) — a real, honest limit of a broad single-word keyword on a
  small sample, not a bug to quietly patch. The keyword list is intentionally left
  as-is; validating which basis (measured vs. curated) actually predicts fill
  difficulty more accurately is explicitly deferred to **S-25's validation work**,
  not fixed here by tuning keywords against one anecdote.
- **Leadership/management titles have no family and land in `general-other` by
  design.** ~33% of real Greenhouse rows (Director/Engineering-Manager/VP titles
  spanning many functions) don't fit any IC-level family. Bundling them into one
  "leadership" family was considered and rejected — a Director role open 90 days
  means something different from a Staff ML Engineer open 90 days, so a blended
  median there would be worse than not measuring it at all. Out of scope for S-23's
  deadline; a real, deliberately deferred gap, not a miss.
- **`retail-ops` (530 real Lever rows) can never be measured under the current
  exclusion rule**, since every one of its observations is Lever-sourced. It will
  ride the decision-026 curated fallback indefinitely unless the family later
  acquires real Greenhouse observations or the Lever exclusion itself is revisited.
- **The Lever data-quality issue behind the exclusion (this decision's Decision B)
  is itself unresolved** — flagged for revisit in S-24 or whenever Lever's field
  semantics are confirmed with a real client integration.

## What this rests on
That Greenhouse's `days_open` (itself already a survivorship-biased proxy for true
time-to-fill) is trustworthy enough, within a family with enough observations, to
stand in for real scarcity evidence — and that Lever's equivalent number currently is
not. Both are judgment calls under real data constraints, not settled facts.

## What would make this wrong
If Ali specifies a different threshold, a different taxonomy, or decides the Lever
exclusion should be lifted (e.g. after confirming Lever's `createdAt` semantics),
this file and `hardToFillConfig.ts`/`familyScarcity.ts` change together; nothing
elsewhere in the codebase depends on today's specific numbers. If S-25's validation
work finds the measured basis is *less* predictive than the curated list it partly
replaces, that's a real finding to act on, not something this decision assumes away.
