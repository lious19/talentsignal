# 004 — Password minimum/maximum length

**Date:** 2026-07-22
**Story:** S-02
**Requirement:** REQ-010
**Decided by:** Megan

## The question
Nothing stopped a one-character password. What's the minimum, and is there a
maximum?

## Options considered
1. No enforced minimum (status quo).
2. A minimum length only, no forced character-class rules (uppercase/digit/
   symbol requirements).
3. A minimum plus forced complexity rules.

## What we chose, and why
Option 2: **minimum 10 characters, maximum 72, no forced complexity rules.**
This follows current guidance (NIST 800-63B) that length matters more than
arbitrary complexity rules, which mostly just push people toward predictable
substitutions ("Password1!") rather than actually stronger passwords.

The maximum of 72 isn't a policy preference — it's a real bcrypt limitation:
bcrypt only hashes the first 72 bytes of its input and silently ignores the
rest. A password of 100 characters and the same password cut off at 72 bytes
would hash identically. Rather than let that happen silently, registration
rejects anything over 72 characters with a clear error.

## What this rests on
No rate-limited online guessing at these lengths is remotely tractable
(combined with the rate limiting in 06_decisions/005), and offline brute-force
resistance is bcrypt's job (06_decisions/006), not the length policy's.

## What would make this wrong
If Ali wants forced complexity rules for a compliance reason (some client
contracts require it), this should be revisited — but it should be an
explicit ask, not a default.
