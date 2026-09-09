# S-24 plan — capacity signals (H-1B LCA, federal awards, SEC Form D)

**Due:** Wed Sep 16, 2026. **Status:** plan only — no code written yet, awaiting Megan's
sign-off on Decisions A/B/C before Step 0 begins.

**One correction that reframes the whole story, surfaced up front rather than buried:**
the ticket says "232 GH + 763 Lever = ~1000 companies." That's wrong — per
`05_presentations/S-23-exploration.md`, `GREENHOUSE_BOARDS=gitlab` and
`LEVER_COMPANIES=gopuff` in this repo's `.env` mean those 995 rows are **995
requisitions from exactly 2 real companies** (GitLab, gopuff), not ~1000 distinct
employers. (Seed-job-board rows have fictional company names and can never match real
government data.) This changes what "match rate" even means here — see §6.

---

## 1. Understanding

S-23's difficulty signal asks "once posted, does this role sit open unusually long for
its family" — an internal, ATS-observed fact. Capacity asks a different question: "has
this employer already committed real money or legal risk to hiring outside their normal
pipeline" — external, third-party-verified intent. LCA is the strongest of the three
because it is the only one that is **role-specific and legally binding**: filing an LCA
means the employer swore under penalty of law it could not fill *this occupation* (named
by SOC code) domestically and is paying immigration legal fees to import someone for it —
direct, occupation-level proof of failed domestic search. Federal awards and Form D only
prove the company has obligations/capital coming, never that any *particular* role is
unfillable, so they can only ever be company-level corroboration, not role-level evidence.

## 2. Three data sources — real feasibility check

### a) H-1B LCA (DOL/OFLC)
a) **URL**: index at https://www.dol.gov/agencies/eta/foreign-labor/performance; files at
   `https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY{YYYY}_Q{N}.xlsx`
   (confirm exact current filename in Step 0 — FY2026 releases are published as
   **cumulative fiscal-year-to-date**, not single-quarter, per DOL's own Q1/Q3 FY26
   announcements).
b) **Format**: Excel `.xlsx` (not CSV). Real-world size: **~75MB for a single quarter, up
   to 600MB+ for a cumulative FYTD file**, several hundred thousand rows. Quarterly
   release cadence. A separate record-layout PDF ships per release.
c) **Auth**: none — static file download, no key, no rate limit (it's a file, not an
   API).
d) **Employer field**: `EMPLOYER_NAME` — free text, self-reported by the filer/attorney,
   **not normalized** (no legal-entity-ID crosswalk to anything else).
e) **Role field**: `SOC_CODE` + `SOC_TITLE` (standardized occupation taxonomy) plus a
   free-text `JOB_TITLE` — genuinely the best-structured role field of the three sources.
f) **Match rate against our real universe (2 companies, not ~1000)**: binary per
   company, not a volume-statistics question. GitLab (mid-size tech co) plausibly has
   LCA history; gopuff (logistics/retail, smaller white-collar footprint) less certain.
   Realistic outcome: 0–2 real company matches. Step 0 is what actually answers this.
g) **Verdict**: worth pursuing — strongest evidentiary value and best role-field
   structure — but budget real engineering time for the 600MB-file problem (§6), and
   don't promise Ali a match *count* until Step 0 reports one.

### b) Federal contract awards (USASpending.gov)
a) **URL**: `POST https://api.usaspending.gov/api/v2/search/spending_by_award/` (JSON
   request/response); `GET /api/v2/awards/<AWARD_ID>/` for a single award's full detail.
b) **Format**: JSON, paginated, queryable live — no bulk file needed, fits an on-demand
   per-company query rather than a scheduled bulk pull.
c) **Auth**: none — "endpoints do not currently require any authorization." No
   documented rate limit found; still worth a client-side backoff since we don't
   control their infra.
d) **Employer field**: `Recipient Name` — the SAM.gov-registered federal-contractor
   legal name, which can differ materially from a consumer brand name.
e) **Role field**: **none.** `NAICS`/`PSC` classify the contract's industry/service type
   (e.g. NAICS 541511 = custom computer programming) — a hint, not an occupation. This
   signal is inherently company-level, never role-specific. **Period-of-performance**:
   confirmed as a real, distinctly-named field — `Period of Performance Start Date`,
   separate from `Base Obligation Date` and `Issued Date`. Ali's exact worry (silently
   grabbing the wrong date) is lower-risk here than feared, *contingent on Step 0
   confirming this against a live query* — not run yet.
f) **Match rate**: GitLab (dev-tools SaaS) plausibly sells to federal agencies via GSA
   schedule; gopuff (consumer delivery) has no obvious federal customer. Realistic: 0–1
   matches.
g) **Verdict**: worth pursuing for API cleanliness, but structurally can only ever bump
   *every* open req at a matched company, never a specific one — folds into Decision C.

### c) SEC Form D
a) **URL**: index at https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets;
   latest quarterly zip e.g.
   `https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip`.
b) **Format**: flattened tabular data extracted from Form D's XML, six related files per
   quarter with a W3C tabular-data metadata file. Exact in-zip format (TSV vs CSV) and
   the issuer-name field's exact name need the record-layout PDF — **unconfirmed, first
   thing to check in Step 0.** Real, verified field: `dateOfFirstSale` (with a
   `yetToOccur` flag when the sale hasn't happened yet). Size: small — **~3–3.6MB
   compressed per quarter.** By far the easiest of the three to parse; no
   streaming-parser problem like LCA.
c) **Auth**: none, but SEC requires a descriptive `User-Agent` header on all sec.gov/
   data.sec.gov requests (their documented fair-access policy) — small, real
   implementation note.
e) **Role field**: **none at all.** Form D is a securities-offering filing; it carries
   zero occupation/job data. Pure company-level timing signal.
f) **Match rate — real risk flag**: GitLab is a **public company** (NASDAQ: GTLB, IPO'd
   2021). Form D exists only for *exempt private* securities offerings, so GitLab is
   categorically ineligible for any current Form D filing — this isn't a maybe, it's a
   structural zero. gopuff is privately held, so historically plausible, but by 2026 its
   fundraising cadence may have slowed; a *recent* Form D hit is not guaranteed either.
   Realistic: likely 0 matches in our current 2-company universe, possibly 1 (gopuff) if
   timing lines up.
g) **Verdict**: risk flag, not a reason to skip — cheapest to build and parse of the
   three, reusable the moment the company universe grows beyond 2, but tell Ali plainly
   it may show zero real matches at demo time. That's an honest, sayable outcome as long
   as LCA or awards produces at least one real hit.

## 3. Three open decisions that must be answered before code

### Decision A — company matching algorithm
| Option | How it works | Precision here | Recall here | Cost | Continuous score? |
|---|---|---|---|---|---|
| Exact-match after normalization | strip Inc/LLC/punctuation, casefold, compare equal | very high | low — misses "GitLab, B.V." or a real legal-entity mismatch entirely | trivial (~1hr) | no — binary, needs a synthetic score |
| Token-Jaccard | intersection/union of normalized word tokens | medium — needs a legal-suffix stopword list or "Inc"/"Group" false-positives | better than exact for reordering/abbreviation | low (~2-3hrs) | yes, naturally [0,1] |
| Jaro-Winkler | character-edit-distance, prefix-weighted | good for spelling variants; **weak for brand-vs-legal-name gaps** (e.g. "Gopuff" vs its actual legal filer name scores near 0 — same failure mode as exact-match for the case that matters most) | same weakness as above | low-medium | yes |
| Entity resolution w/ threshold | composite of the above + a tiny hand-seeded alias table for known variants | highest achievable without a paid resolution API, because the alias table directly targets our *actual* 2-3 companies | highest, same reason | medium (~1 day) | yes, and a manual-alias hit can be forced to 1.0 |

**Recommend: entity resolution (token-Jaccard as the continuous base + a small
hand-seeded alias table)** — bounded scope, not a general resolver: Step 0 will tell us
exactly what legal names GitLab/gopuff actually filed under (if any), and those go
straight into the alias table as literal, honest, curated matches. This mirrors decision
046's own measured/curated split — reusing a pattern this team already validated rather
than inventing a new one. Stays a pure heuristic (weighted string ops + a lookup table),
compliant with CLAUDE.md rule 5 (no ML).

### Decision B — match-confidence threshold and label
Proposed (heuristic, PROPOSED pending Ali, same posture as every other threshold in this
codebase):
- **≥0.85, or a manual-alias hit (forced 1.0) → "high-confidence"** — shown, factor
  contributes fully.
- **0.5–0.85 → "low-confidence"** — shown explicitly labeled, contribution *dampened* by
  the confidence value itself (a 0.6-confidence match contributes 60% of a full hit)
  rather than a hard in/out cutoff — more honest than binary, and this is exactly what
  acceptance criterion 3 asks for.
- **<0.5 → dropped** — not surfaced as a factor at all (below 0.5 a match is more likely
  wrong than right); still logged for debugging, never shown as if it were evidence.

Reasoning: 0.5 is the natural "more likely wrong than right" line for a probability-
shaped score; the 0.5–0.85 band is what makes "surfaced as low-confidence, not silently
dropped or trusted" (criterion 3) concretely true rather than aspirational.

### Decision C — weight and factor shape
**One composite `capacitySignal` factor**, not three separate ones — LCA is
role-specific (can join on SOC/title overlap), but awards and Form D are structurally
company-level only, so a single composite with a per-source strength multiplier avoids
needing three separate weight budgets for signals of very different granularity:
`contribution = weight * matchConfidence * sourceStrength` (proposed sourceStrength: LCA
1.0, awards 0.6, Form D 0.5 — LCA is the strongest evidence per §1). The rationale string
names the exact source(s) that fired (criterion 1). Company-level sources apply their
contribution to *every* open req at a matched company — stated plainly as company-level
in the rationale, so nobody mistakes it for role-specific evidence the way LCA is.

**Reweighting**: current weights sum to 1.0 (roleScarcity 0.6, daysOpen 0.2,
repostedRole 0.2). Recommend a proportional shrink to make room for `capacitySignal` at
**0.20** (the story's own suggested number): roleScarcity → 0.48, daysOpen → 0.16,
repostedRole → 0.16 (each ×0.8), + 0.20 = 1.0 exactly, preserving the "[0,1] by
construction" invariant `hardToFillConfig.ts` relies on. **Flag for Ali explicitly**:
S-23 justified roleScarcity's 0.6 as "dominant, the one genuinely new signal" —
dropping it to 0.48 dilutes that framing and deserves a sentence of his sign-off, not a
silent change.

**Version bump**: yes — `hard-to-fill-026-v2` → `hard-to-fill-026-v3`, same discipline
as the v1→v2 bump (weights *and* what the score composition means both change).

**hardToFillThreshold (0.50)**: recommend leaving unchanged. The four weights still sum
to 1.0, so the threshold's meaning doesn't mechanically shift. Only worth revisiting if
Step 0's real match count is so low it never moves any score across the line — which is
fine (the rationale still names it per criterion 1) even if it never flips the badge.

## 4. Step 0 — exploratory query pass (read-only, stop after)
Same discipline as S-23's Step 0:
- Pull the smallest usable recent LCA file (a single non-cumulative quarter if one still
  exists, else the earliest FY2026 FYTD release), stream/prefilter for `EMPLOYER_NAME`
  loosely containing "gitlab" or "gopuff" — do not attempt a full parse-then-filter given
  the file size.
- Query USASpending's `spending_by_award` directly for recipient-name text "GitLab" and
  "Gopuff" (and plausible legal-name variants once Step 0's LCA/Form D passes surface
  any), record real results.
- Download the current Form D quarterly zip (~3.6MB), inspect the actual record layout
  (confirm the issuer-name field name), filter for GitLab/gopuff — explicitly test the
  hypothesis that GitLab (public co) has zero hits.
- Write real findings — match counts, real employer-name strings actually encountered,
  a real match-confidence distribution if a draft of Decision A's algorithm is run
  against them — to `05_presentations/S-24-exploration.md`.
- **Stop. Wait for Megan's review before Step 1.**

## 5. Build plan
1. **Adapter layer.** `MarketSignalProvider` does not fit — its shape (`company`,
   `title`, `daysOpen`, `isRepost`, `hasSalaryRange`) is job-posting-specific, and none
   of these three sources produce job postings. Propose a new sibling interface,
   `CapacitySignalProvider`, mirroring decision 040's own precedent (they explicitly
   rejected overloading one interface to do two jobs) — three concrete implementations
   (Lca/FederalAwards/FormD), each following Greenhouse/Lever's raw-persist-before-parse,
   per-item isolation, `fetchWithTimeout` pattern. Raw persistence: a **new**
   `raw_capacity_signals` table, not `raw_requisitions` — migration 018's own comment
   says raw_requisitions is reserved for requisition source-of-truth, and a capacity
   filing is categorically not a requisition (category error to reuse it).
2. **Company matching module** — a pure function (`matchCompany`), no DB/IO,
   unit-testable like `classifyFamily()`/`familyScarcity.ts`, implementing Decision A's
   chosen algorithm plus the small seeded alias table.
3. **New `capacitySignal` factor** wired into `hardToFillScore.ts` following
   `familyScarcity.ts`'s exact shape: a lookup computed once per scoring run, passed in
   like `familyScarcity` is; `basis: "measured" | "curated" | "none"` on the factor
   (measured = high-confidence match, curated = low-confidence-but-shown, none = no
   match or that source unavailable); rationale strings name the exact source, mirroring
   roleScarcity's phrasing convention exactly.
4. **Frontend surfacing** — extend the existing "How this was scored" section (already
   built) to show the capacity rationale line(s) verbatim plus the match-confidence
   label — rationale strings mention LCA/award/Form D specifically, per the story's own
   requirement.
5. **Decision doc + real-run artifact** — a new `06_decisions/0XX-capacity-signals.md`
   with 046's exact discipline (three-state basis, known-limits, "what would make this
   wrong"), plus Ali's standing-rule artifact: a diagram/chart generated from an actual
   run proving at least one real opportunity's hardness rose from a real capacity
   signal, every input labeled live/seeded/stubbed, match confidence honestly shown.

## 6. What could go wrong
- **LCA file size.** A 600MB xlsx cannot be parsed at boot or request time — needs a
  one-off/scheduled ETL script (mirrors `scripts/ingest-once.ts`/
  `scripts/backfillFamilyKey.ts`'s existing pattern), using a streaming xlsx reader, not
  a full in-memory load. This needs its own small design pass inside Step 1, not a
  hand-wave.
- **Match-rate risk, reframed.** Given the *real* 2-company universe (not ~1000), a
  "<5% of 995 requisitions match" outcome isn't just possible, it's near-guaranteed by
  construction even with a perfect algorithm — at most 2 companies can ever match at
  all. A requisition-count success bar is unwinnable at this data scale. **Recommend
  telling Ali the success criterion should be "at least one real company, honestly
  confidence-labeled, demonstrably raises a real requisition's hardness" — not a
  population match-rate percentage** — before building toward a bar that can't be hit.
- **Federal contract awards field semantics** — lower risk than feared: `Period of
  Performance Start Date` is a real, distinctly-named field, not conflated with
  obligation/issued dates in the documentation. Still needs Step 0 to confirm against a
  live query before trusting it in code — getting this silently wrong is exactly the
  class of failure Ali warned about.

## 7. What I need from Megan before building
- Sign-off on Decisions A/B/C (my recommendations above).
- Which source to prototype first in Step 0 — Ali named LCA strongest, but it's also the
  most expensive to touch first (600MB file) versus awards/Form D's cheap live
  queries/small files. Recommend Megan choose the order rather than assuming LCA-first
  by default.
- Confirm Step 0 should be a small/targeted spot-check (single quarter, prefiltered by
  our 2 real company names) rather than a full-quarter parse — a full parse is Step 1
  engineering, not a read-only Step 0 spot-check.
- Whether to raise the "~1000 companies is actually ~2" correction with Ali before or
  during the build — recommend before, since it changes what a defensible success bar
  even looks like for this story.
