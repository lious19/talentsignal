# 034 — CORS_ORIGIN must accept a list, not a single string

**Date:** 2026-08-28
**Story:** S-20
**Requirement:** REQ-020 context (public deploy), decision 031 (three-origin deploy shape)
**Decided by:** Megan (found by Claude Code during S-20 gate G4, PROPOSED — code change not yet
applied, awaiting Megan's review of the diff)

## The question

Gate G4 asked whether `backend/src/app.ts`'s CORS middleware can accept the three origins
S-20's deploy shape (decision 031) actually needs — `https://talentsignal.colaberry.com`, the
Render backend default host, and the Render frontend/static-site default host — via a
comma-separated `CORS_ORIGIN` env var.

## What was found

`backend/src/app.ts:35`:
```ts
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
```
The `cors` npm package's `origin` option, when given a plain string, treats that string as one
single literal value and echoes it back verbatim as the `Access-Control-Allow-Origin` response
header for every request — it does not split on commas. Setting
`CORS_ORIGIN="https://a,https://b,https://c"` in Render would send
`Access-Control-Allow-Origin: https://a,https://b,https://c` on every response, which no
browser accepts as a valid single-origin value — every cross-origin request from any of the
three real origins would be rejected by the browser's own CORS check, not by the server. This
would break the frontend Static Site talking to the backend Web Service immediately upon
deploy, since decision 031 put them on different Render hosts.

Also found: the line 39–41 comment above this code (*"S-20 serves the built frontend with no
Vite dev server in front of it"*) assumes a same-origin deploy — Express serving the built
frontend itself. No `express.static`/`sendFile` serving of a frontend build actually exists
anywhere in `backend/src` (checked). This comment predates decision 031 (frontend as a separate
Render Static Site, not served by Express) and is now stale/inaccurate, not describing real
code. Not a functional bug — nothing depends on it — but worth a one-line correction alongside
the CORS fix so a future reader isn't misled about the deploy topology.

## What we chose, and why

**Proposed fix (not yet applied — diff below, pending Megan's review):** parse
`CORS_ORIGIN` as a comma-separated, whitespace-trimmed list and pass the array form to `cors`,
which natively supports an array of allowed origins. Chosen over a custom origin-callback
function because the `cors` package's array support already does exactly what's needed (checks
the request's `Origin` header against the list, echoes back only a match) with no extra code,
and because a wildcard (`*`) remains supported unchanged when `CORS_ORIGIN` is a single `*` —
matching current local-dev behavior when the env var is unset.

```diff
--- a/backend/src/app.ts
+++ b/backend/src/app.ts
@@ -32,7 +32,10 @@ export function createApp(
   const app = express();
 
-  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
+  const corsOrigin = process.env.CORS_ORIGIN ?? "*";
+  const corsOrigins =
+    corsOrigin === "*" ? "*" : corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
+  app.use(cors({ origin: corsOrigins }));
   app.use(requestLogger);
   app.use(express.json({ limit: "10kb" }));
 
-  // Every route lives under /api. S-20 serves the built frontend with no
-  // Vite dev server in front of it, so nothing can depend on the dev
-  // proxy's path rewrite to make these paths line up.
+  // Every route lives under /api. The frontend is a separate Render Static
+  // Site (decision 031), not served by this process, so CORS_ORIGIN must
+  // list every real origin that calls this API.
   app.use("/api", healthRouter(pool));
```

## What this rests on

That a plain array of exact-match origin strings (no wildcard subdomain matching, no regex) is
sufficient — true for the three known origins today. If Cloudflare later fronts the app with a
domain that isn't one of these three exact strings, `CORS_ORIGIN` needs updating in Render's
dashboard, same as today, just now actually effective for more than one value at a time.

## What would make this wrong

If `cors`'s array-origin behavior ever needs to do something dynamic (e.g., allow any
`*.onrender.com` subdomain without listing each one) — today's fix doesn't support that; would
need the callback-function form of `origin` instead. Not needed for S-20's three known,
fixed hosts.
