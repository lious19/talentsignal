# 014 — Pipeline stage transitions: freeform, not a forced sequence

**Date:** 2026-07-30
**Story:** S-08
**Requirement:** REQ-004
**Decided by:** Megan, pending Ali's confirmation — this is a judgment call, not
something Ali's build note specifies.

## The question
Must a client step through `prospecting -> contacted -> negotiation -> closed` in
order, or can a rep move a client to any stage from any stage?

## Options considered
1. Constrained: enforce the linear sequence, reject out-of-order jumps.
2. Freeform: allow any stage -> any other stage, always audited.

## What we chose, and why
Freeform. Ali's build note doesn't describe a state machine, and a real sales process
needs reversals a strict sequence would block — e.g. a deal falling through in
negotiation and reverting to contacted, or a client re-entering prospecting after going
cold. The trust requirement (every change audited, who/when/from/to) already gives full
visibility into any "unusual" jump; a sales rep should not be blocked from recording
reality by a state machine that doesn't match how deals actually move.

This also gives the idempotency requirement for free: if the requested `toStage`
already matches the current stage, the update is a no-op (no audit row) rather than a
meaningless "moved from X to X" entry — so retrying an identical request (a UI
double-click, a network retry) is automatically safe.

## What this rests on
No forward-only workflow requirement stated by Ali. Every transition, forward or
backward, produces an audit row — the audit trail is the safeguard, not a state
machine.

## What would make this wrong
If Ali, on return, wants transitions constrained to the forward sequence (or a defined
set of allowed reversals), this becomes a CHECK-constraint-shaped or application-level
state-machine change on top of the existing audit logic — the audit write itself
doesn't change, only what's allowed to reach it.
