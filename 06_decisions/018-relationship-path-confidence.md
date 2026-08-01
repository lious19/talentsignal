# 018 — Relationship path confidence scoring, and why confirm/dismiss isn't an audit trail

**Date:** 2026-08-01
**Story:** S-10
**Requirement:** REQ-006, REQ-020
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

Two things: how should a warm-path's confidence score be computed (another heuristic
scorer, same transparency discipline as `matchScore.ts`/`confidenceScore.ts`), and should
`relationship_path_decisions` be an append-only audit table like S-08/S-09's, or an
ordinary mutable one?

## Options considered — confidence scoring

1. **Two-level `strength` (`strong`/`weak`) per edge, multiplicative combination, flat
   penalty per hop beyond the first.**
2. A precise numeric strength (e.g. `0.0`–`1.0`, freely chosen at seed time) — more
   expressive, but invites a number nobody can defend ("why is this edge 0.73 and not
   0.7?"), the same problem `06_decisions/011` avoided with `MATCH_CONFIG`'s saturation
   cap.
3. Additive combination (sum edge scores, normalize) — lets a long chain of weak edges
   outscore a single strong direct connection, which is backwards: more hops should never
   look MORE trustworthy than fewer.

## What we chose, and why

**Option 1.** Two levels a rep can actually reason about when seeding an edge ("is this a
strong relationship or a weak one?") rather than inventing false precision. Multiplicative
combination — `confidence = strengthScore(edge1) * strengthScore(edge2) * ... *
additionalHopPenalty^(hops-1)` — same reasoning as `matchScore.ts`'s fit score
(`06_decisions/011`): a weak link anywhere should drag the whole path down, not be
smoothed out by averaging. A direct 1-hop `strong` edge (`0.8`) always outranks any 2-hop
path, by construction, since a 2-hop path is at best `0.8 * 0.8 * 0.6 = 0.384`.

```ts
// backend/src/relationships/relationshipConfig.ts
export const RELATIONSHIP_CONFIG = {
  strengthScore: { strong: 0.8, weak: 0.4 },
  additionalHopPenalty: 0.6,
};
```

Worked example: rep →(colleague, weak)→ Jordan →(knows_contact, strong)→ Acme Corp:
`confidence = 0.4 * 0.8 * 0.6 = 0.192`. Every path's response includes a `factors` array
— one row per edge (its own `strengthScore` as `contribution`) plus one synthetic
hop-penalty row when `hops > 1` — so a rep sees exactly why a path scored what it did,
never a bare number (TBI rule 2).

## Why `relationship_path_decisions` is a plain table, not an append-only audit table

S-08 and S-09 both built DB-trigger-enforced append-only audit tables
(`sales_pipeline_audit`, `opportunity_package_release_audit`) because both stories
protect an accountability trail S-15 explicitly needs to read — "who moved this stage,"
"who released this package." S-10's trust scenario asks for something narrower: "only
confirmed paths count," i.e. a real, queryable state distinction — it does not ask for a
history of every time a rep flip-flopped on whether a relationship is real. Making
`decide` reversible (a rep can change confirmed → dismissed or back) is itself a
deliberate difference from S-09's terminal release: S-09 gates something leaving the
platform (must be provably one-way); S-10 only gates an internal signal-quality flag
nothing currently acts on, so reversibility costs nothing and matches how people actually
reconsider "was that really a warm contact?"

`relationship_path_decisions.decided_by` is registered in `pii_fields` with
`reset_to_empty` (migration 008), not `retain_exempt` — `retain_exempt` is reserved for
the audit-exemption carve-out `06_decisions/013` defined specifically for append-only
tables. Since this table isn't one, its identity column gets the same treatment as any
other.

## What this rests on

That `strong`/`weak` is expressive enough to be useful — a real deployment might want more
granularity once there's actual seeded relationship data to look at.

## What would make this wrong

If Ali wants a confirm/dismiss HISTORY later (e.g. "did this rep already dismiss this
path once before re-confirming it?"), that's a small additive change — a
`relationship_path_decision_events` table alongside the existing mutable one, same
mutable/append-only split as `sales_pipeline`/`sales_pipeline_audit` — not a redesign of
what's built here.
