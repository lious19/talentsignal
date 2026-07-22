# 002 — JWT lifetime and refresh tokens

**Date:** 2026-07-22
**Story:** S-02
**Requirement:** REQ-010
**Decided by:** Megan, on Claude Code's recommendation — pending Ali's confirmation

## The question
The story's own open question: "short-lived JWT" — 15 minutes with a refresh
token, or 1 hour with no refresh?

## Options considered
1. 15-minute access token + a refresh token (rotation, storage, revocation).
2. 1-hour access token, no refresh token.

## What we chose, and why
Option 2 — 1 hour, no refresh. A refresh-token flow is a second token type
with its own storage, rotation policy, and revocation logic — real scope,
better built deliberately alongside a dedicated session-management concern
(or S-14's RBAC work) than bolted onto this story under deadline pressure.

## What this rests on
The tradeoff we're accepting outright: **a stolen access token is valid for
up to an hour and cannot be revoked before it expires.** There is no server-
side session store to invalidate it early — whoever holds a valid token can
use it until its `exp` claim passes, full stop.

## What would make this wrong
If a token is ever exfiltrated in a way we know about (a leaked log, a
compromised client), we have no way to cut it off before expiry — that's the
concrete cost of this choice. If that risk becomes real rather than
theoretical, or once S-14 needs finer-grained session control, revisit with a
refresh-token design at that point rather than retrofitting revocation onto
a bare access token.
