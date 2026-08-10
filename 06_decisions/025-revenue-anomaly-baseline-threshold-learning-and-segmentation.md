# 025 — Revenue proxy, anomaly baseline/threshold-learning mechanism, and segmentation dimension

**Date:** 2026-08-09
**Story:** S-17
**Requirement:** REQ-016, REQ-015
**Decided by:** Megan — all four items below CONFIRMED this session, as the human owner of
this story, pending Ali's review (same "PROPOSED, pending Ali" framing as decision 020's
KPI definitions).

## The question

S-17 asks for a threshold/baseline anomaly detector on a "revenue KPI" plus advisory
client segmentation "by need." Ali's own text flags four judgment calls explicitly and
asks that none be assumed silently: what counts as the revenue KPI, what "normal" means,
how the threshold learns without becoming a black box, and what "need" means for
segmentation.

## 1. Revenue proxy — placements per month, named explicitly as a PROXY

**Confirmed.** There is no monetary column anywhere in this schema — grepped every
migration and route for `revenue|amount|price|deal_value|contract_value`, zero matches.
`placements_per_month`, the exact series S-12 (decision 020) and S-13 (decision 021)
already compute and trust, is reused as the revenue proxy `ANOMALY_CONFIG.metric`.

**This is flagged prominently for Ali**, exactly as decision 020 flagged its own deviation
from Ali's build note: his story text says "revenue" repeatedly and specifically. This is
a substitution he needs to confirm or override, not a redefinition of revenue as real
currency. If Ali wants real revenue tracked, that requires a new migration (a `deal_value`
column) and a real decision about what a deal is worth — out of scope here.

### What this rests on
That a staffing agency's revenue is earned per placement, making placements-per-month the
closest real signal to "a revenue outcome" that exists today without fabricating data.

### What would make this wrong
If Ali confirms real dollar figures are needed for R4 or beyond, this proxy gets replaced
by a real column and this decision is revisited — the swap only touches
`ANOMALY_CONFIG.metric` and the one query that reads it, not the detection math itself.

## 2. Baseline definition — the OLS trend-fitted value, reusing computeForecast() unmodified

**Confirmed.** "Normal" for a given month = `computeForecast()`'s (S-13, `demandForecast.ts`)
own fitted trend value for that point, over the full available history (same
`FORECAST_CONFIG.minHistoryMonths = 3` floor S-13 already uses) — not a flat mean or a
separate rolling window. A flat mean would falsely flag a steadily-growing trend as
anomalous every month, the exact problem decision 021 already reasoned through when it
rejected moving-average/SES methods in favor of a trend line.

`revenueAnomaly.ts`'s `classifyAnomalies()` calls `computeForecast()` directly and reuses
its `historical[].fitted`/`.residual`/`residualStd` completely unmodified — S-13's file has
zero changes. The one thing NOT reused is `computeForecast()`'s own `isOutlier` flag,
which is permanently tied to `FORECAST_CONFIG.outlierStdDevs` (a fixed constant S-13
owns). S-17 re-classifies every point against its own, separately mutable `kStdDev`
instead, so suppressing a false positive here can never change what S-13's forecast chart
calls an outlier, and vice versa — the two features share math, not tuning state.

### What this rests on
That reusing S-13's regression is both correct (same underlying data, same trend-fitting
reasoning) and honest (no second, silently-different definition of "normal" living next to
the first on the same dashboard).

### What would make this wrong
If Ali wants a materially different notion of "normal" for revenue specifically (e.g. a
shorter rolling window, or seasonality-aware), this is a change scoped entirely to
`revenueAnomaly.ts` — `demandForecast.ts` still wouldn't need to change.

## 3. Threshold + "the threshold learns" — mutable per-metric kStdDev, suppress-only widening

**Confirmed, this is the item scrutinized closest.** The number: `isAnomaly = |residual| >
kStdDev × residualStd`, starting at `ANOMALY_CONFIG.baseKStdDev = 2` — the same 2-sigma
constant `FORECAST_CONFIG.outlierStdDevs` uses, so a viewer sees one consistent definition
of "unusual" across both dashboard sections before any human tuning happens.

**The entire "learning" mechanism, stated so it can be defended out loud:** `kStdDev` is a
per-metric, mutable, persisted value (`anomaly_thresholds`, one row for
`placements_per_month`). **Confirming** an anomaly does not change it — record-only, proof
the point was reviewed. **Suppressing** does exactly one thing: `kStdDev` widens by a
fixed, documented step (`ANOMALY_CONFIG.suppressionStepStdDev = 0.5`), capped at
`ANOMALY_CONFIG.maxKStdDev = 4`. The before/after value is recorded in the audit row's
`detail` JSONB. No model, no weights, no black box — a human reading `anomaly_audit` can
predict exactly what the next suppression will do.

**Deliberate asymmetry, confirmed, not silently built:** confirming a real anomaly never
narrows the threshold back down, and there is no automatic decay over time. Narrowing or
decay would require inventing a second mechanism ("how much should the band re-tighten,
and how fast") that S-17's text never asks for.

### What this rests on
That "one number, moved by one fixed amount, on one explicit human action, in one
direction" is genuinely transparent — the TBI's own bar ("must stay a TRANSPARENT
heuristic... explainable out loud — NOT a black box that 'just learns'").

### What would make this wrong — OPEN scope question for Ali
**Not resolved here, flagged plainly:** should a confirmed-real anomaly pattern ever be
allowed to narrow the band back down, or should an unsuppressed threshold decay back
toward baseline after some period of quiet? Nothing in S-17's acceptance criteria asks for
either, and building one silently would be inventing a second business rule Ali hasn't
seen. If he wants it, it's an additive change to the `/decide` handler and
`ANOMALY_CONFIG`, not a redesign.

## 4. Segmentation dimension — hiring volume (open job_openings count), advisory only

**Confirmed.** Clients are bucketed by their current open `job_openings` count
(`SEGMENTATION_CONFIG.thresholds`: 0–1 low, 2–4 medium, 5+ high) — a real, directly
queryable, FK-backed signal. The alternatives Ali's text names were rejected for concrete
reasons: no `industry` column exists (would mean guessing from `clients.name` text —
fabrication); no canonical role-type vocabulary exists in `job_openings.title`/
`requirements` free text (clustering it would mean inventing categories or reaching for
NLP, against "heuristic-first, don't reach for ML"); and building on
`opportunities`↔`clients`'s existing fuzzy name-match join (decision 015's still-open gap)
would compound an already-flagged weak point rather than avoid it.

**Advisory only by construction, not just by policy:** `segmentClients()` is a pure
function with no I/O; its output is read by exactly one route
(`GET /api/analytics/anomalies`) and by no automated-targeting code path anywhere else in
this codebase (`recommendationEngine.ts`, `opportunityPackage.ts`, etc. never read a
client's segment). There is no code path that could turn a segment into automated
targeting — satisfying the trust line structurally.

No new table — computed on the fly in the route, mirroring decision 020's "no Analytics
snapshot table" reasoning exactly.

### What this rests on
That open hiring volume is a real, useful "need" signal for an agency manager (a client
with 7 open roles needs different attention than one with zero) and that avoiding
fabricated categories matters more than covering every dimension Ali's text lists as an
option.

### What would make this wrong
If Ali confirms a real `industry` column is worth adding, or wants a formal role-type
taxonomy, segmentation gets a second dimension alongside hiring volume — additive, not a
replacement.

## 5. Role gating — GET stays broad, POST /decide is narrower

**Confirmed, split explicitly.** `GET /api/analytics/anomalies` stays `admin`/`sales`/
`recruiter` — the same viewer set `AnalyticsDashboard.tsx` is already wired behind in
`App.tsx` (decision 022), so this route doesn't introduce a new visibility boundary for a
screen that already exists. `POST /api/analytics/anomalies/decide` is narrower —
`admin`/`sales` only — because it mutates the *shared* `anomaly_thresholds` row, matching
the exact write-guard precedent decision 024 set for S-16's CRM write/rollback routes
(narrower gating for anything that writes shared state than for reading it).

### What this rests on
That decide's write is meaningfully different from a read, in the same way S-16's write
routes were treated differently from `clients.ts`'s read routes — a real, deliberate
asymmetry, not an oversight.

### What would make this wrong
If Ali wants recruiters able to tune the threshold too, this is a one-line change to
`DECIDE_ROLES` in `revenueAnomalies.ts` — no other code depends on the narrower set.

## What this whole decision rests on

That items 1–5 are correctly settled by Megan's confirmation this session (S-17's own
framing: "propose, log in decision 025, flag for Ali — no silent assumptions"), and that
item 3's narrowing/decay question is genuinely Ali's call to make, not a code decision.

## What would make items 1, 2, 4, 5 wrong

Each reverses independently without touching the others: a real revenue column replaces
the proxy (item 1) without changing the detection math; a different baseline window
changes `revenueAnomaly.ts` without touching `demandForecast.ts` (item 2); a second
segmentation dimension is additive (item 4); a role-set change is a one-line edit (item 5).
