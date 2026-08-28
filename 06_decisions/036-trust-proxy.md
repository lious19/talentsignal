# 036 — `app.set('trust proxy', 1)` for the Render deploy

**Date:** 2026-08-28
**Story:** S-20
**Requirement:** REQ-017 context (rate limiting), REQ-020 context (audit correctness)
**Decided by:** Megan

## The question

Render sits the app behind its own load balancer / TLS-terminating proxy. Without telling
Express to trust that one hop, `req.ip` and `req.secure` reflect Render's internal proxy, not
the real client — breaking `express-rate-limit` (decision 005, keyed by IP) and anything that
logs or reasons about the caller's real address or protocol.

## What we chose, and why

`app.set('trust proxy', 1)`, added once, before the CORS/rate-limit middleware in
`backend/src/app.ts`. `1` (not `true`) trusts exactly one hop — Render's own proxy — rather than
trusting the entire `X-Forwarded-*` chain unconditionally, which would let a client spoof its
own IP by sending a fake header if Express trusted an arbitrary number of hops.

## What this rests on

That Render's architecture puts exactly one proxy hop between the public internet and the
container — standard for Render's Web Service product, not verified against Render's own
infra docs beyond that assumption.

## What would make this wrong

If Render's edge changes to more than one hop (e.g. a CDN layer added in front later), `1`
would need to become the actual hop count, or `req.ip` silently reverts to seeing an
intermediate proxy's address again.
