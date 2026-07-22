# 008 — Where the frontend stores the JWT

**Date:** 2026-07-22
**Story:** S-02 (gap closed during S-03)
**Requirement:** REQ-010
**Decided by:** Megan

## The question
The register/login screens receive a JWT from the API. Where does the
browser hold onto it between requests: `localStorage`, or an `httpOnly`
cookie set by the server?

## Options considered
1. **`localStorage`.** The frontend reads/writes it directly and sends it
   itself as an `Authorization: Bearer` header on every request. Simple —
   no backend changes beyond what S-02 already built.
2. **`httpOnly` cookie.** The server sets the cookie on login/register; the
   browser attaches it automatically; JavaScript can never read it.
   Requires: `cookie-parser` (or equivalent) in Express, `requireAuth`
   reading from the cookie instead of a header, a CSRF defense (cookies are
   attached automatically cross-site, unlike a header the page has to add
   itself), and a CORS/`SameSite` policy that depends on whether the
   frontend and backend end up on the same origin in production — which
   S-20 (deployment) hasn't decided yet.

## What we chose, and why
Option 1, `localStorage`, for now.

**The real tradeoff, stated plainly:** `localStorage` is readable by any
JavaScript running on the page. If this app ever has an XSS vulnerability —
a dependency with a compromised script, an unescaped user-supplied string
rendered into the DOM — that script can read the token directly and exfiltrate
it. An `httpOnly` cookie closes exactly that hole: JavaScript cannot read it
under any circumstance, XSS included.

We're accepting that exposure for now because the correct cookie
configuration (`SameSite`, `Secure`, same-origin vs. cross-origin `CORS`
with credentials) depends on how the frontend and backend are actually
served in production, and S-20 hasn't fixed that topology yet. Building the
cookie plumbing now risks building it against the wrong assumption and
redoing it at S-20 anyway.

## What this rests on
That the 1-hour token lifetime (06_decisions/002) bounds how long a stolen
token is useful, and that this is a class/demo project on mocked data, not a
production system holding real client data yet.

## What would make this wrong
If S-20 lands with frontend and backend on the same origin (which looks
likely, since production serves the built frontend from the same process
that serves `/api`), the cookie approach becomes cheap — same-origin means
no CORS-credentials complexity, just `Secure` + `SameSite=Strict` and a CSRF
token. At that point, revisit this and switch, since there's no longer a
topology reason not to. If real client data lands in this app before S-20,
that's also a reason to revisit sooner rather than waiting.
