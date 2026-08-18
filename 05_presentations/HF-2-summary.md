# HF-2 — Tie the hard-to-fill score into opportunities & surface it

**Status:** Built & verified (commit `1d148a6`). Backend 252 tests pass, frontend 32 pass,
both typechecks clean. Depends on HF-1; role list/weights/threshold still **PROPOSED**
pending Ali (`06_decisions/026`).

## What it does (plain English)
HF-1 could already answer "how hard is this role to fill?" for a single signal, but that
number lived nowhere — it wasn't stored or shown. HF-2 wires it into the real flow: when
the hidden-demand path scores an incoming signal for **confidence**, it now *also* runs
`hardToFillScore()`, saves that result on the opportunity, returns it from the API, and the
Opportunities screen shows a **"hard to fill"** badge — always with its reason.

## The assumption it rests on
HF-1's proposed role keyword list, weights, and the `0.5` badge threshold (decision 026,
awaiting Ali). HF-2 only *surfaces* that score; it invents no new scoring. If Ali changes
the list or threshold, only `hardToFillConfig.ts` changes — HF-2's plumbing stays correct.

## What would make it wrong
Computing the score anywhere but the existing scoring seam (duplicating logic); showing the
badge without its reason (a bare flag — the exact thing the trust scenario forbids); or the
new column silently altering existing confidence behaviour. All three are covered by tests.

## How it was built (reused, didn't rebuild)
- **Migration `013`** adds `hard_to_fill_score / _reasons / _factors / _version` to
  `opportunities`, mirroring exactly how `005` added the confidence breakdown (same
  backfill-then-drop-default discipline; backfilled rows read as "not flagged", never a
  false badge).
- **`upsertBatch()`** in `hiddenDemand.ts` computes `hardToFillScore(signal)` *alongside*
  `scoreSignal(signal)` and stores both. `scoreSignal()` is untouched — one place per score
  (S-07 / 026).
- **`toOpportunityResponse()`** (the single row→response shaper both routes reuse) now
  returns the HF score, reasons, factors, version, and a derived `hardToFill` boolean
  (score ≥ the 026 threshold). No second shaper to drift.
- **Opportunities screen** badges it with its reason inline, plus an inspectable
  weight/value/contribution breakdown — the same transparency the confidence score has.

## Trust scenario (the loop stop)
The flag never renders alone. The badge and its "why" appear as one unit
("hard to fill: in-demand role type, open 30 days, reposted role"), and the full weighted
breakdown is one click away — a manager can trust it or dismiss it, never handed a bare
badge. Verified by frontend tests (badge-with-reason present; no badge when un-flagged) and
backend tests (reasons non-empty; breakdown present even when NOT flagged).

## Tests added
- Backend `hiddenDemand.hardToFill.test.ts` (5): flagged role carries score + reasons;
  breakdown always present even un-flagged; **confidence unchanged (no regression)**;
  idempotent re-analyze (one row, identical HF result); GET route returns the HF fields.
- Frontend `OpportunitiesList.test.tsx` (+3): badges with reason; no badge when un-flagged;
  factor breakdown inspectable.

## Definition-of-done caveat (honest)
Everything above is green locally. The one DoD item not exercised **this session** is
"runs in the deployed demo" — the migration is written to the same pattern as `001`–`012`
and typechecks, but hasn't been applied against a live Postgres here (no local DB running;
the migration integration test skips without `DATABASE_URL`). Apply it via
`docker-compose up` / the CI migration step before demoing.

## Still open (flagged, not guessed)
HF-1's role list, weights, and `0.5` threshold remain Ali's call (026). HF-2 is built so his
answer is a one-line config edit with no change to this wiring.
