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
