# 016 — How many candidates go in a drafted package

**Date:** 2026-08-01
**Story:** S-09
**Requirement:** REQ-005
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

S-09's own design notes call this out directly: "what goes in the package is a small
judgment call — propose it, log it." Once PackageAgent ranks candidates for a job (reusing
S-06's `scoreCandidate`), how many of them should actually appear in the drafted package?

## Options considered

1. **All ranked candidates**, regardless of count or fit score — complete, but a package
   with a 0%-fit candidate padded in isn't a curated proposal, it's a dump of the whole
   candidate pool.
2. **A fixed top-N**, same shape as S-06's own ranking cutoff-free list but now bounded —
   simple, predictable, easy to defend.
3. **A fit-score threshold** (e.g. only candidates above some cosine similarity) — avoids
   a hard count, but invents an unvalidated cutoff number that's harder to reason about
   than "top 3."

## What we chose, and why

**Option 2, with N = 3.** `PACKAGE_CONFIG.topCandidateCount = 3` in
`backend/src/packages/packageConfig.ts`. A small, fixed count keeps a package skimmable —
the whole point of drafting is to save a rep from re-deriving a ranking themselves, not to
hand them the same full list `/client-matchmaking/match` already returns. 3 is a
starting guess, not a researched number: enough to give a rep options without recreating
the un-curated full list.

## What this rests on

That 3 is a reasonable "how many is a proposal, not a dump" cutoff for this stage's demo
candidate pool sizes. Like `MATCH_CONFIG`'s weights (06_decisions/011) and
`CONFIDENCE_CONFIG` (007), this is a config constant, not hardcoded inline, specifically
so Ali (or a later story) can change the number without touching `composePackage.ts`.

## What would make this wrong

If Ali wants packages sized differently per opportunity (e.g. a role with many open
requisitions gets more candidates than a single-hire role), a flat constant stops being
enough and this becomes a per-job or per-opportunity parameter instead.
