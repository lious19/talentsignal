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
| — | JWT lifetime — 15 min + refresh, or 1 hr no refresh? | S-02 | soft |
| — | Confidence score: what factors, what weights? | S-03 | **hard — ask Ali** |
| — | TypeScript or JavaScript? (DoD says "tsc clean") | all | **hard — ask Ali** |
