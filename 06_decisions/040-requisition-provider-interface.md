# 040 — Requisition provider interface, and the isRepost/S-22 scope boundary

**Date:** 2026-08-29
**Story:** S-21
**Requirement:** ticket acceptance criteria 1–4 (real requisition lands with source+timestamp;
raw persisted before parsing; idempotent on source+external id; per-board failure isolation)
**Decided by:** Megan (approved from a plan-mode research pass; Angel gave the ticket)

## The question

Two things needed deciding before writing any adapter code: (1) should `GreenhouseProvider`/
`LeverProvider` extend the existing `MarketSignalProvider` interface with a new method, get a
brand-new sibling interface, or something else; (2) since neither Greenhouse's nor Lever's
public API exposes an explicit "this posting was reposted" field, what does S-21 actually ship
for `MarketSignal.isRepost`?

## Options considered (interface)

1. Extend `MarketSignalProvider` with a new `fetchRequisitions()` method Greenhouse/Lever
   override.
2. A new sibling `RequisitionProvider` interface, `MarketSignalProvider` untouched.
3. **Chosen:** `GreenhouseProvider`/`LeverProvider` implement the existing
   `MarketSignalProvider.fetchSignals()` contract directly — no interface change at all.

## What we chose, and why

Option 3. `05_presentations/signal-provenance-sheet.md` (written the same day, before this
decision) already states the design intent in plain terms: *"the Greenhouse + Lever connectors
(S-21) plug into the **same** seam — one wiring line in `server.ts`, no change to any scorer.
Provenance changes at the adapter and nowhere else."* That's a direct answer, not just a hint.
Options 1 and 2 both add a second contract nothing needs: option 1 would force
`MockJobBoardProvider`/`SeedJobBoardProvider` to grow a meaningless stub method just to keep
compiling; option 2 duplicates a contract (`fetchSignals(options): Promise<MarketSignal[]>`)
that already does everything required. Same "don't make one thing do two jobs" discipline
decision 026 already applied to scorers, applied here to interfaces.

**What actually changed instead:** each provider's *constructor* takes a `Pool` (for raw
persistence) and a token/handle list (`GreenhouseProvider(pool, boardTokens)`,
`LeverProvider(pool, companyHandles)`) — `fetchSignals()`'s public signature is byte-for-byte
identical to `MockJobBoardProvider`'s. `backend/src/ingestion/ingestRequisitions.ts` is new, but
it is not itself a provider — it's a thin orchestrator that calls whichever
`MarketSignalProvider`s it's handed (independently, each isolated) and feeds the combined
result into the **existing** `upsertBatch()`, the same function `seedDemo.ts` already calls
directly, bypassing the live HTTP route. `backend/src/adapters/marketSignalProvider.ts`,
`mockJobBoardProvider.ts`, `seedJobBoardProvider.ts`, `backend/src/routes/hiddenDemand.ts`, and
every scorer are untouched by this story.

**Failure isolation (criterion 4) lives at two levels, not one:** each provider isolates
failures *per board/handle* internally (one bad Greenhouse token in a multi-token
`GREENHOUSE_BOARDS` list doesn't blank out the others), and `ingestRequisitions.ts` isolates
failures *per provider* on top of that (Greenhouse's entire API being unreachable doesn't stop
Lever's postings from landing). Discovered as a real gap during implementation, not part of
the original plan-mode draft: each provider additionally isolates failures *per item within a
board* — a single job/posting that fails to parse (`toMarketSignal()` throws) doesn't stop the
next job in the same board from being fetched, raw-persisted, and parsed. This is what makes
the trust guarantee below actually true for every item, not just the ones fetched before a bad
one.

## Options considered (isRepost)

1. A same-run heuristic — e.g. flag `isRepost` when a `requisition_id` (Greenhouse only) or
   posting text repeats within one fetch.
2. **Chosen:** `isRepost: false` on every first-sighting row, explicitly deferred to S-22.

## What we chose, and why

Option 2. Verified directly against real, live data during design (not assumed): neither
Greenhouse's nor Lever's public postings expose a repost flag. Greenhouse's `requisition_id`
field is a real, plausible signal — the same `requisition_id` reappearing under a *new* job
`id` is how ATS systems typically represent a reopened requisition — but detecting *that*
requires comparing against our own ingestion history across multiple runs, which is exactly
what `05_presentations/signal-provenance-sheet.md` already assigns to **S-22 (longitudinal
diffing)**, not S-21. Shipping a same-run guess now would either (a) always read `false`
anyway, since no single fetch can show a requisition_id repeating, making the "heuristic" a
no-op dressed up as real logic, or (b) require building history-comparison machinery inside
S-21 that duplicates what S-22 is explicitly scoped to build properly. `daysOpen`, by contrast,
*is* computed for real in S-21 — Greenhouse's `first_published` and Lever's `createdAt` are
real, single-fetch fields, better than the provenance sheet's own text implied before this
research verified them.

## What this rests on

That `signal-provenance-sheet.md`'s S-21/S-22 split is the real, current plan, not a stale note
— confirmed by Angel's own S-21 ticket text, which frames "daysOpen and repostedRole become
measurable data once real postings land" as S-21's *motivation*, not a claim that S-21 computes
a fully accurate `isRepost` itself.

## What would make this wrong

If Ali wants a same-run `requisition_id`-based guess attempted now regardless of its limited
power (open question 1 in the S-21 plan, answered by Megan as "defer cleanly" before this
decision was logged) — that reverses this file's second half only; the interface choice above
is independent and holds either way.
