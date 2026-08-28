# 032 — Defer the JWT `httpOnly` cookie switch to R5

**Date:** 2026-08-28
**Story:** S-20
**Requirement:** REQ-010
**Decided by:** Megan
**Updates:** `06_decisions/008-jwt-storage-location.md`

## The question

Decision 008 explicitly deferred choosing between `localStorage` + `Authorization: Bearer` and
an `httpOnly` cookie until S-20, once the frontend/backend deploy topology was known. That
topology is now known (decision 037: one Render service, same-origin) — does S-20 make the
switch now, or defer again?

## What we chose, and why

**Defer to R5**, alongside S-21. Keep `localStorage` + `Authorization: Bearer` exactly as it is
for S-20. The cookie switch is a real cross-cutting code change — `cookie-parser`, every
`requireAuth` call site reading from a cookie instead of a header, a CSRF defense, `SameSite`/
`Secure` config, and (had decision 037 not landed) `credentials: 'include'` on every frontend
`fetch()` call. That is not a day-of-deadline change with S-20 already three days late, and
decision 037's same-origin outcome removes the specific cross-origin cookie complexity that
made this urgent in the first place — same-origin `Secure`+`SameSite=Strict`+CSRF is cheap
*whenever it's done*, not only if done today.

## What this rests on

That the 1-hour token lifetime (decision 002) continues to bound how long a stolen
`localStorage` token is useful, and that this remains a demo on mocked/synthetic data, not a
production system holding real client data, through R5.

## What would make this wrong

If real client data lands in this app before R5, or if an XSS vector is found in the deployed
frontend, this reverses immediately regardless of R5's schedule — decision 008's original
tradeoff analysis (XSS exposes a `localStorage` token; an `httpOnly` cookie does not) still
applies unchanged.
