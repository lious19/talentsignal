# S-23 exploration — Step 0 (read-only, pre-build)

**Purpose:** ground the family taxonomy and the pooled-vs-per-source median decision in
real numbers before any scoring code changes. No code changed in this pass.

**Data source — live, not seeded:** local Postgres (`docker compose up -d db`), migrated to
`017_raw_requisitions_run_id.sql`, populated by a real `npm run ingest:once` run against the
two public boards configured in `.env.example` (no secrets — public, unauthenticated
syndication endpoints):

- `GREENHOUSE_BOARDS=gitlab` → 232 real GitLab requisitions
- `LEVER_COMPANIES=gopuff` → 763 real gopuff requisitions
- Total: **995 opportunities**, all live-sourced, run at 2026-09-03T00:01Z, correlation id
  `0bab4fe2-2aea-4c86-975d-189bc27cc082`

(Close to but not identical to the 222/818 figures in `05_presentations/S-22-summary.md` —
expected, since this is a fresh live poll of the same two boards on a different day; both
boards' listings churn over time. No seed-job-board rows included in these queries.)

---

## 1. Critical finding: "source" here means "one company per source," not many boards

`raw_requisitions.source` only ever takes two values in this dataset: `greenhouse` (= GitLab,
the only Greenhouse board configured) and `lever` (= gopuff, the only Lever company
configured). There is **no per-board grouping to check within a source** — the entire Lever
population *is* the gopuff board. The "Lever outlier" risk flagged in the plan isn't one
board skewing a multi-board Lever population; it's a **structural difference between the two
ATS integrations' `days_open` semantics**, or between the two companies' actual posting
behavior — and the numbers below make that gap look too large to be posting-age alone.

## 2. Median days_open — pooled vs. per-source

| scope | median days_open | n |
|---|---|---|
| pooled (both sources) | **876** | 995 |
| greenhouse (GitLab) only | **33** | 232 |
| lever (gopuff) only | **1,169** | 763 |

Lever's median is **~35x** Greenhouse's. `days_open` is derived in `computeDiffs.ts` from
`raw_response` JSONB — Greenhouse's `first_published`, Lever's `createdAt` — evaluated
against the latest `fetched_at`. A sampled Lever `raw_response` shows normal-looking, live
gopuff job content (real salary ranges, real benefits copy) with nothing suggesting these are
stale/abandoned listings — so **1,169 days is very likely an artifact of what Lever's
`createdAt` field actually represents** (possibly the req's or account's original creation
date on Lever's platform, not the listing's live-since date), not evidence that gopuff roles
are genuinely harder to fill than GitLab roles by 35x. This was already flagged as "real but
unusually old, not investigated" in an earlier S-22 note — this pass confirms it's not a
one-off; it's the median, i.e., the norm for this source.

**Consequence for the family-median design:** pooling `days_open` across sources for any
family that spans both Greenhouse and Lever will be dominated by whichever source contributes
more rows to that family, and the two sources are not on a comparable scale. A family that's
90% Lever rows will inherit Lever's ~1,169-day center of mass almost regardless of the
Greenhouse rows mixed in.

## 3. How much this actually matters in practice — family bucket sizes

Tested a draft family taxonomy (ILIKE substring, pooled across both sources) against the real
995 rows:

| family | greenhouse | lever | total | clears n≥10? | single-source? |
|---|---|---|---|---|---|
| engineering-swe | 56 | 0 | 56 | yes | 100% greenhouse |
| retail-ops | 0 | 530 | 530 | yes | 100% lever |
| sales-bizdev | 38 | 175 | 213 | yes | **mixed — 18% GH / 82% lever** |
| ml-ai | 22 | 0 | 22 | yes | 100% greenhouse |
| support-cs | 21 | 0 | 21 | yes | 100% greenhouse |
| security | 12 | 0 | 12 | yes | 100% greenhouse |
| cloud-infra | 6 | 0 | 6 | no | — |
| data-analytics | 0 | 3 | 3 | no | — |

**This changes the Decision B risk estimate for the better:** at threshold 10, **6 of 8**
draft families clear it (not the "1-3 families" estimated abstractly before real data was
available) — because GitLab and gopuff's title vocabularies are so different (GitLab is
almost entirely software/tech/GTM roles; gopuff is almost entirely retail/warehouse ops, plus
a handful of corporate roles) that most families end up **naturally single-source**, which
sidesteps the cross-source scale problem for them. Sanity check: `engineering-swe` computed
*within greenhouse only* has median days_open **19** (n=50) — a clean, comparable number,
nothing like the pooled 876.

**The one family that doesn't sidestep the problem is `sales-bizdev`** (38 GH + 175 Lever) —
a real mixed-source family where pooling would blend GitLab's ~33-day scale with gopuff's
~1,169-day scale into a number that represents neither.

**Recommendation to bring back for decision:** compute each family's median **within-source**
first; if a family has ≥10 observations in more than one source, treat those as separate
measured cohorts (e.g. "sales-bizdev (greenhouse)" and "sales-bizdev (lever)" against their
own source's global median) rather than one blended number. A family with <10 in a given
source simply doesn't get a measured value for that source and relies on the curated
fallback there. This avoids inventing a cross-ATS normalization scheme (out of scope, no
evidence to justify one yet) while still letting same-source families compare fairly.

## 4. Current decision-026 curated list, measured against real data

The existing 10-keyword list (`data analyst`, `data scientist`, `ai architect`, `ai
engineer`, `ml engineer`, `machine learning engineer`, `data engineer`, `cybersecurity`,
`security engineer`, `cloud architect`) matches **16 greenhouse + 2 lever = 18 of 995 rows**
(1.8%). Confirms decision 026's own description of itself as a narrow, hand-picked list —
plenty of room for a broader family taxonomy to add real coverage without touching the
fallback's behavior for those 18 rows.

## 5. Distinct-title reality (why family-level, not title-level, grouping is required)

| source | distinct titles | total rows |
|---|---|---|
| greenhouse | 220 | 232 |
| lever | 738 | 763 |

Titles are almost all unique (a handful of GitLab titles repeat 2x for regional variants,
e.g. "Business Development Representative"). Exact-title grouping would never reach n≥10 for
almost anything — confirms family-level keyword bucketing (not per-title stats) is the only
viable measured-basis approach, consistent with the plan's Decision A.

## 6. Top titles by source (sample, for taxonomy grounding)

**Greenhouse (GitLab)** — dominated by software engineering (`Backend Engineer`, `Software
Engineer`, `Staff Backend Engineer`), solutions/support engineering, sales (`Account
Executive`, `Business Development Representative`, `Commercial Account Executive`), and a
real scatter of AI-labeled titles (`AI Engineer`, `AI Transformation Owner` x2, several
`AI Engineering: ...` backend roles).

**Lever (gopuff)** — dominated by retail/warehouse operations (`Store Associate` ×many
location variants, `Key Holder` ×many, `Forklift Operations Associate`, `Liquor Barn -
[role]` ×many, `Operations Associate` — 15 occurrences, the single most common exact title
in the whole dataset), plus a small corporate tail (`Data Engineer`, `Director, Data
Science`, `Lead Data Analyst`, `Corporate Counsel`, `Category Manager`).

## 7. Proposed family taxonomy (draft, grounded in the above — final list belongs in Step 1)

- `engineering-swe` — software/backend/frontend engineering (currently 100% greenhouse)
- `ml-ai` — AI/ML-labeled roles (currently 100% greenhouse)
- `security` — security/cybersecurity roles (currently 100% greenhouse)
- `support-cs` — support/customer success/solutions architecture (currently 100%
  greenhouse)
- `sales-bizdev` — account executive/BDR/sales (mixed source — needs the within-source
  split above)
- `retail-ops` — store/warehouse/retail operations (currently 100% lever)
- `data-analytics` — data analyst/scientist/engineer titles outside `ml-ai`'s AI framing
  (currently only 3 rows — stays a fallback-only family unless the taxonomy is refined)
- `cloud-infra` — cloud/infra/SRE/devops (currently only 6 rows — same caveat)
- `general-other` — catch-all fallback for anything unmatched

---

## Stop point

Per the plan's Step 0, this is where the pass stops for review. Two things need a decision
before Step 1/3 proceed:

1. **Within-source median computation** (§3) instead of pooled-across-source, specifically
   for mixed-source families like `sales-bizdev`.
2. **`data-analytics` and `cloud-infra` staying fallback-only** at threshold 10 given the
   real counts above — acceptable as-is (this is what acceptance criterion 2 is for), or
   worth widening their keyword lists first to see if real coverage improves.
