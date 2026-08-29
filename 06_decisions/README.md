# Decision log

One entry per business-logic choice. **Write these in your own words** — this is the file
that proves you understood what was built rather than approved it.

`CLAUDE.md` rule 4: scoring weights, thresholds, segment definitions, and confidence
formulas are business decisions. Claude Code must stop and ask. The answer lands here.

Copy the template below into a new file named `NNN-short-title.md`.

---

```markdown
# NNN — <short title>

**Date:** YYYY-MM-DD
**Story:** S-XX
**Requirement:** REQ-XXX
**Decided by:** Megan / Ali / both

## The question
What actually had to be decided, in one or two sentences.

## Options considered
1. …
2. …

## What we chose, and why
Plain English. No jargon you couldn't defend out loud.

## What this rests on
The assumption underneath it.

## What would make this wrong
The observation that should make us revisit it.
```

---

## Open decisions — not yet answered

| # | Question | Story | Blocking? |
|---|---|---|---|
| 007 | Confidence score: what factors, what weights? (proposal drafted, awaiting Ali) | S-03 | **hard — ask Ali** |
| 011 | Match score: skills/experience weight split (0.7/0.3), experience saturation cap, and combination shape (multiplicative, proposal drafted, awaiting Ali) | S-06 | **hard — ask Ali** |
| 011 | Availability: display-only for now — needs Ali to define a vocabulary before it can become a real filter | S-06 | soft |
| — | TypeScript or JavaScript? (DoD says "tsc clean") | all | **hard — ask Ali** |
| — | Recruiter self-service account creation before S-14? (see 003, resolved for now by 010) | S-02 | soft |
| — | Field-level vs whole-record PII gating (see 009) — decided with Megan, not yet Ali | S-05 | soft |
| — | Is REQ-017's p95 exempt for auth endpoints? (see 006) | S-02 | soft |
| — | JWT storage: localStorage now, revisit at S-20 if origin topology makes an httpOnly cookie cheap (see 008) | S-02/S-20 | soft |
| 015 | Opportunity↔job linkage: require both ids explicitly, proposal drafted, awaiting Ali | S-09 | soft |
| 015 | Erasure strategy for a RELEASED package's `content` — reset_to_empty vs. retain, needs Ali + possibly a small S-15 design change | S-09 | **hard — ask Ali** |
| 016 | Package top-candidate count (N=3, proposal drafted, awaiting Ali) | S-09 | soft |
| 017 | Relationship edge model: no client_contacts table, undirected, whole-graph search, company-name anchor match | S-10 | soft |
| 018 | Relationship path confidence weights (strong=0.8/weak=0.4, hop penalty=0.6, proposal drafted, awaiting Ali) | S-10 | soft |
| 019 | Recommendation feedback: upsert-latest vs. append-only history, given TBI's "over time" language | S-11 | **hard — ask Ali** |
| 020 | Analytics KPI definitions (placements/time-to-hire/demand score) — proposed, pending Ali | S-12 | **hard — ask Ali** |
| 020 | **No Analytics table built — DEVIATES from Ali's build note, which explicitly asked for one.** Computed on the fly instead. Reversible if he wants the table. | S-12 | **hard — ask Ali, veto-able at the gate** |
| 023 | Consent default `true` (opt-out), not the GDPR-faithful opt-in — a documented pragmatic exception (no consent-collection UX exists yet); the revoke round-trip, not the default, is the real trust proof | S-15 | **hard — ask Ali** |
| 023 | Erasure/access scoped to the registry's primary-row entries only — embedded copies elsewhere (e.g. `opportunity_packages.content`) are a known, stated limitation, not chased down | S-15 | soft |
| 023 | Encryption: off-by-default `DATABASE_SSL` flag + honest demo-vs-production documentation, nothing fabricated | S-15 | soft |
| 024 | CRM write role gating (`admin`+`sales`) creates an asymmetry with `clients.ts`'s `PII_VISIBLE_ROLES` (`admin`+`recruiter`) — sales can write contactInfo it can't read elsewhere | S-16 | soft |
| 024 | **OPEN — can a rollback resurrect data a legitimate S-15 erasure already scrubbed?** `before_image`/`after_image` left unregistered (not `retain_exempt`) on purpose; compliance-faithful lean is erasure should win, not resolved unilaterally | S-16 | **hard — ask Ali** |
| 025 | Revenue KPI has no backing data anywhere in the schema — `placements_per_month` reused as an explicit, named PROXY, not real currency | S-17 | **hard — ask Ali** |
| 025 | Anomaly threshold "learning" = suppress-only fixed-step widening (+0.5σ, capped at 4σ); confirm is record-only; no auto-narrowing or decay | S-17 | soft |
| 025 | **OPEN — should a confirmed-anomaly pattern ever narrow the threshold back down, or should it decay over time?** Not built; flagged as a real scope question | S-17 | **hard — ask Ali** |
| 025 | Segmentation dimension = hiring volume (open `job_openings` count), advisory only, no new table | S-17 | soft |
| 025 | `/decide` role-gated narrower (`admin`/`sales`) than the `GET` view (`admin`/`sales`/`recruiter`), matching decision 024's write-guard precedent | S-17 | soft |
| 028 | Concurrency ladder (1/10/50/100/250/500), `DB_POOL_MAX` comparison value (20), `SEED_SIGNAL_COUNT` (2000), and CI-guard deferral to S-19 — all proposed, awaiting Ali | S-18 | soft |
| 028 | Hard-to-fill targeting seed-visibility fix (`includeSeedData` opt-in + seed-title keyword variation) — proposal drafted, awaiting Ali | S-18 | soft |
| 029 | E2E-critical journeys (the two named in S-19's Gherkin), lint = tsc-as-lint, perf threshold deferred again, seed dataset shape — proposed, awaiting Ali | S-19 | soft |
| 029 | Setting `DATABASE_URL` in CI promotes every self-skipping integration/append-only/migrate test into a required blocking gate for the first time — a real behavior change, not just new files, worth Ali's awareness before S-20 | S-19 | soft |
| 030 | Repo name (`talentsignal`), visibility (private — recommended), and full-history push strategy, plus pre-push audit findings — proposed, awaiting Ali/Megan's actual push | REPO | soft |
| 040 | Greenhouse/Lever providers implement the existing `MarketSignalProvider` directly (no interface change); `isRepost` defers cleanly to S-22's longitudinal diffing, `daysOpen` computed for real from each provider's own timestamp field | S-21 | soft |
| 041 | `raw_requisitions` is a new, append-only table (`UNIQUE (source, external_id, fetched_at)`, one row per fetch — history for S-22, not overwritten); parsed rows reuse the existing `opportunities` table, no new parsed-data table | S-21 | soft |
| 042 | `upsertBatch` chunks into batches of 200 (sequential, chunk-level failure isolation) instead of one atomic statement, after the first live run's 1,036 real signals hit the pool's 5s `statement_timeout` — timeout deliberately NOT raised | S-21 | soft |
