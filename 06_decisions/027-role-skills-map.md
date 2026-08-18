# 027 — Role → skills map for hard-to-fill targeting (HF-3)

**Date:** 2026-08-18
**Story:** HF-3
**Decided by:** Megan — PROPOSED, pending Ali. Chosen by Megan on 2026-08-18 from three
options (see below).

## The question
HF-3 surfaces, for each hard-to-fill opportunity, the students best matched to submit.
Matching (`scoreCandidate`, S-11) ranks candidates against a job's **required skills**.
But a hard-to-fill opportunity is a market signal — it carries a company and a role
title, **not a skills list** — and decision 015 explicitly refused to invent an
opportunity↔job_opening link ("no existing FK relating them"). So there is nothing for the
matcher to rank against until we bridge role → skills.

## Options considered
1. **Role → skills map (PROPOSED, chosen).** A transparent config mapping each hard-to-fill
   role type to representative required skills, so targeting is automatic: pick a
   hard-to-fill opportunity → see matched students. One new PROPOSED business assumption.
2. **Explicit opportunity + job pairing.** The user links each opportunity to a real
   job_opening (which has `requirements[]`); rank against that. Zero new assumptions,
   reuses the S-09 package pattern — but adds a manual pick step and needs seeded jobs.
3. **Match on title tokens only.** Treat the title as the requirement. No config, but
   candidates list granular skills (python, sql), so `["data","analyst"]` rarely matches —
   mostly empty results.

## What we chose, and why
Option 1. It keeps HF-3 self-contained and demoable (Ali wanted to *see* the "inside
scoop" for sales), and it is the same heuristic-first, transparent, swappable, Ali-gated
pattern already used for the confidence weights (007) and the hard-to-fill list (026): a
guess someone has to author, put in one config object, marked PROPOSED, changeable in one
line. The map lives in `backend/src/matching/roleSkillsConfig.ts` and **imports** HF-1's
`HARD_TO_FILL_CONFIG.roleKeywords` rather than duplicating it, so a role resolves to the
same type HF-1 flagged it under — one source of truth.

## Proposed values
Each hard-to-fill role keyword → 5 representative skills (data analyst → sql, python, data
visualization, statistics, excel; ai architect → machine learning, cloud, mlops, python,
system design; etc. — see `roleSkillsConfig.ts` for the full map).

## What this rests on / what would make it wrong
That these skills are what a staffing salesperson would treat as the core requirements for
each role — our best guess, not Ali's answer (same caveat as 007/026). If Ali specifies
different skills per role, a different set of roles, or wants requirements pulled from real
job descriptions instead of a static map, that is a one-line-per-role edit to
`roleSkillsConfig.ts`, touching nothing else. The skill matching inherits `scoreCandidate`'s
documented exact-string limitation ("JS" ≠ "JavaScript").

## Related assumption (also flagged, see HF-3 summary)
"Students" = the candidates already in the `candidates` table — assumed per the build-out
doc ("assumed until Ali says otherwise"), pending Ali.
