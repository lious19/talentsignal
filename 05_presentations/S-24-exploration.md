# S-24 exploration — Step 0 (read-only, pre-build)

**Purpose:** spot-check whether any of the three capacity sources actually contain our
two real companies (GitLab via Greenhouse, gopuff via Lever) before writing a line of
adapter code. Real queries against live external data, run 2026-09-09. No code changed
in this pass — everything below ran from throwaway scripts outside this repo.

**Scope, as agreed:** one recent file/quarter per source, targeted at exactly two
company names ("GitLab", "gopuff") plus a couple of obvious legal-name variants. Not a
full parse, not a general-purpose matcher — that's Step 1.

---

## 1. H-1B LCA (DOL/OFLC)

**File used:** `LCA_Disclosure_Data_FY2026_Q1.xlsx` — confirmed live at
`https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2026_Q1.xlsx`,
73MB, HTTP 200, `Last-Modified: 2026-02-04`. Covers Oct–Dec 2025 filings. This is the
most recent complete quarter published (FY2026 Q2/Q3 URLs return 404 — not yet posted
under this naming pattern as of today).

**Correction to the plan's assumption:** this file is a normal single-quarter size
(~73MB), *not* a 600MB cumulative-FYTD file as I'd guessed from secondary sources before
touching the real data. Worth knowing before Step 1 designs the ETL script — the
worst-case file size risk is real but this particular quarter isn't it.

**Real structure, confirmed by unzipping the xlsx (it's a zip of XML):**
- `xl/worksheets/sheet1.xml` — 571MB uncompressed, dimension `A1:CT1042438` →
  **1,042,437 real LCA case rows** in this one quarter (more than either of my earlier
  estimates).
- `xl/sharedStrings.xml` — 11MB, 331,635 unique strings (`uniqueCount="331635"`).
  Confirmed column headers include `EMPLOYER_NAME`, `TRADE_NAME_DBA`, `SOC_CODE`,
  `SOC_TITLE`, `JOB_TITLE`, `NAICS_CODE` — matches the plan's field expectations.

**Method:** streamed the shared-string table only (`unzip -p ... xl/sharedStrings.xml`)
and grepped case-insensitively — every distinct string in the workbook, including every
distinct `EMPLOYER_NAME`, appears somewhere in this pool, so this is a valid presence/
absence test without parsing the 571MB row data.

**Pipeline sanity check** (to prove the grep actually works against this file, not a
silent miss): `amazon` → **45 occurrences**, `google` → present. Confirms the extraction
pipeline is real and functioning.

**Result:**

| query | occurrences |
|---|---|
| `gitlab` (case-insensitive) | **0** |
| `gopuff` | **0** |
| `go puff` | 0 |
| `git lab` | 0 |

**Honest finding: zero LCA filings for either company in FY2026 Q1 (Oct–Dec 2025).**
This is one quarter only — it does not rule out a filing in a different quarter (LCAs
are filed continuously through the year); it only says neither company filed one in
this specific three-month window. Ali named LCA the strongest signal for data/AI roles
specifically — neither GitLab nor gopuff's real hiring in this quarter apparently
required H-1B sponsorship, at least not one that cleared final determination in this
window.

## 2. Federal contract awards (USASpending.gov)

**Endpoint used:** `POST https://api.usaspending.gov/api/v2/search/spending_by_award/`,
no auth. Two real queries, `award_type_codes: ["A","B","C","D"]` (contracts), full
available window (2007-10-01 onward — the API itself enforces this floor for search;
older data needs a separate bulk-download endpoint).

**First attempt used `keywords` (full-text search), not `recipient_search_text` — a
real gotcha worth flagging:** searching `keywords: ["GitLab"]` returned awards to
*other* companies (FCN Inc., Accenture Federal Services, World Wide Technology, etc.)
whose award **descriptions** mention GitLab (almost certainly GitLab license
resells/subscriptions bundled into a larger IT contract) — not GitLab itself as
recipient. **`keywords` searches award text broadly; `recipient_search_text` is the
correct filter for "is this company the recipient."** Re-ran with the right filter:

**GitLab** (`recipient_search_text: ["GitLab"]`) — **4 real awards found:**

| Recipient (as filed) | Award ID | Amount | Awarding agency | Date signed |
|---|---|---|---|---|
| GITLAB INC. | NNG16LA11P | $18,268.20 | NASA | 2016-07-20 |
| GITLAB INC. | W911W416P0029 | $7,800.00 | Dept of Defense | 2016-09-26 |
| GITLAB INC. | N6523617P0007 | $5,850.00 | Dept of Defense | 2017-02-08 |
| GITLAB B.V. | SAQMMA15M1068 | $4,900.00 | Dept of State | 2015-05-07 |

**gopuff** (`recipient_search_text: ["Gopuff"]`) — **0 results.**

**Real, unflagged risk this surfaces:** all four GitLab awards are **2015–2017** —
a decade stale as of today (2026-09-09), and all are small-dollar (sub-$20K, likely
software-license micro-purchases, not staffing-relevant contracts). A "capacity
signal" is supposed to indicate *current* hiring pressure; a 2016 NASA purchase order
says nothing about GitLab's staffing needs today. **Recency needs its own explicit
rule in Step 1** (e.g. only count awards with `date_signed` or period-of-performance
start within the last N months) — Step 0 didn't design that rule, it just proved the
naive version (any award, ever) would surface stale, low-value noise as "evidence."

**Field-name finding, directly on Ali's stated worry:** the search endpoint's `fields`
parameter accepted `"Period of Performance Start Date"` as a field name without
erroring, but **every result came back with that field `null`**, including for the
confirmed real GitLab awards. Fetching one award's full detail via
`GET /api/v2/awards/<generated_unique_award_id>/` shows the real, populated value:

```json
"period_of_performance": {
  "start_date": "2016-07-20",
  "end_date": "2016-08-31",
  ...
}
```

**So the field is real and correctly named, just not returned by the search endpoint's
flat `fields` list for this award type — a second per-award detail call is required to
get it.** This is good news relative to Ali's fear (we're not at risk of silently
grabbing the *wrong* date field), but it's a real two-step-fetch cost to design for in
Step 1, not a non-issue.

**Recipient identity fields, noted for Decision A:** the award-detail response also
carries `recipient_uei` (Unique Entity Identifier, e.g. `DAMDA7UKMRJ8` for GitLab) and
`recipient_unique_id` (legacy DUNS). Neither ATS source (Greenhouse/Lever) carries a
UEI/DUNS for the employer, so this doesn't give us a free exact-match key today — but
worth remembering if a future story adds a company registry with UEIs.

## 3. SEC Form D

**File used:** `https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip`
— **3.8MB**, confirmed live, `Last-Modified: 2026-07-09`. This is the most recent
quarterly release (Q2 2026, i.e. filings through 2026-06-30).

**Real structure inside the zip** (matches the plan's expectation of six files):
`SIGNATURES.tsv`, `FORMDSUBMISSION.tsv`, `RELATEDPERSONS.tsv`, `ISSUERS.tsv`,
`OFFERING.tsv`, `RECIPIENTS.tsv`, plus `FormD_metadata.json` and a readme. All TSV, not
XML — the "XML-based" description on SEC's page refers to the *source* filings; the
data-set extract itself is flat tab-separated text, trivial to parse.

**Confirmed real field names** (previously unconfirmed in the plan):
- `ISSUERS.tsv` → issuer legal name field is **`ENTITYNAME`** (not a guess anymore).
- `OFFERING.tsv` → the "first sale" field is actually named **`SALE_DATE`**, with a
  separate **`YETTOOCCUR`** flag — not `dateOfFirstSale` as an earlier secondary source
  suggested. Joins to `ISSUERS.tsv` via `ACCESSIONNUMBER`.

**Result:** 16,852 issuer rows this quarter. Pipeline sanity-checked against "openai"
(8 real hits, plausible for OpenAI's various filing entities) to confirm the search
pipeline works.

| query | occurrences (ISSUERS.tsv, ENTITYNAME + all other columns) |
|---|---|
| `gitlab` | **0** |
| `gopuff` | **0** |

**Honest finding, and the structural one predicted in the plan came true:** GitLab is a
public company (NASDAQ: GTLB) and Form D only covers exempt *private* offerings — zero
was the expected, structural outcome, not a surprise. gopuff's zero is a real, live
finding, not a structural certainty — privately-held companies raise intermittently;
this only says gopuff didn't file in this specific quarter, not that it never has.

## 4. Match-confidence, worked by hand on the one real match we found

Decision A recommended token-Jaccard as the continuous base score. Running it by hand
against the one real hit (GitLab's two federal-award recipient-name variants) against
our ATS company string `"GitLab"`:

| ATS name | Real filed name | Naive token-Jaccard (no suffix stripping) | With legal-suffix stopword list (inc/llc/corp/b.v./...) |
|---|---|---|---|
| GitLab | GITLAB INC. | {gitlab} ∩ {gitlab,inc} / {gitlab} ∪ {gitlab,inc} = **0.50** | {gitlab} / {gitlab} = **1.0** |
| GitLab | GITLAB B.V. | {gitlab} ∩ {gitlab,b,v} / ... = **0.33** | {gitlab} / {gitlab} = **1.0** |

**This is a concrete, real proof of why Decision A's stopword-list requirement isn't
optional:** naive token-Jaccard on "GITLAB B.V." scores **0.33 — below the 0.5 "dropped"
line from Decision B** — which would silently throw away a real, correct match (GitLab's
Netherlands entity) for want of stripping "b.v." as a legal suffix, exactly the way
"inc"/"llc" need stripping. Step 1's stopword list must include international entity
suffixes (B.V., GmbH, Ltd, S.A., etc.), not just US ones, or a real match like this one
gets dropped and mislabeled as "no capacity signal" when a signal actually exists.

## 5. Summary table

| Source | GitLab | gopuff | Notes |
|---|---|---|---|
| H-1B LCA (FY2026 Q1) | 0 | 0 | one quarter only |
| Federal awards (all-time via API) | **4 real awards** (2015–2017, stale, small $) | 0 | recency filter needed before this counts as "capacity" |
| SEC Form D (2026 Q2) | 0 (structural — public co) | 0 | one quarter only |

**Overall: one real signal found (federal awards, GitLab), and it's stale enough
(2015-2017) that it likely should NOT clear a "current capacity" bar without a recency
rule Step 1 hasn't designed yet.** As things stand from this one spot-check, neither
company has a *current* capacity signal from any of the three sources. This is
consistent with what the plan flagged as the realistic range (0–2 matches) — it's the
low end of that range, and worth Ali knowing going into the 2pm framing conversation
about the ~1000-companies correction, since it bears directly on what a demo-day proof
point can honestly claim.

---

## Stop point
Per the plan's Step 0, this is where the pass stops for review. Two things worth
deciding before Step 1:
1. **A recency rule for company-level capacity signals** (federal awards especially) —
   a decade-old award shouldn't carry the same weight as one signed last quarter. Not
   designed here; flagged for Step 1.
2. **The legal-suffix stopword list must be international**, not US-only — proven
   necessary by §4's own numbers, not a hypothetical.
