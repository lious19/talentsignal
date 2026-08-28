# 037 — Revert S-20 deploy shape to a single Render service

**Date:** 2026-08-28
**Story:** S-20
**Requirement:** unblocks S-20 after `npm ci` failed on the local machine (Windows file-lock
on `@esbuild/win32-x64/esbuild.exe`, blocking gate G5's frontend build)
**Decided by:** Megan (approved, path B)
**Supersedes:** `06_decisions/031-deploy-shape.md` (Render Static Site + Web Service split)

## The question

Gate G5 hit a local `npm ci` failure in `frontend/` (Windows `EPERM` on `esbuild.exe`, held by
a lingering process) before the frontend build could even run. Rather than debug a local
process-lock issue under today's deadline pressure, is there a deploy shape that sidesteps the
whole class of problem — and does the existing code already support it?

## What was found

The code was already built for a single-origin deploy, not the two-origin split decision 031
chose:
- Every `fetch()` call across `frontend/src/*.tsx` uses a **relative** path (`fetch("/api/...")`),
  never an absolute URL or a `VITE_API_BASE`-style env var. Confirmed with
  `grep -rn "fetch(\|axios" frontend/src` — no absolute base URL anywhere.
- `frontend/vite.config.ts`'s own comments (lines 15–18) already say *"the backend serves every
  route under /api itself now... S-20 serves the built frontend with no Vite dev server"* —
  i.e. the dev-time proxy config was written assuming Express would serve the built frontend in
  production, the same assumption `backend/src/app.ts`'s now-corrected comment (decision 034)
  had before the split.
- Nothing in `frontend/src` uses client-side routing (`grep -rn "react-router"` — no match), so
  there's no deep-link path that would need an Express catch-all serving `index.html` for
  unknown routes; plain `express.static` is sufficient today.

## Options considered

1. **Keep 031's split** (Static Site + Web Service) and debug the local `npm ci` lock — the
   file lock is a local Windows process issue, not a code defect, so it's fixable, but costs
   time neither the deadline nor gate G5's purpose (proving the build works) actually need
   spent, given the code was never written for the split in the first place.
2. **Revert to one Render Web Service**, Express serving both `/api/*` and the built frontend's
   static assets — chosen.

## What we chose, and why

Option 2. Zero frontend code changes needed — every fetch call already works same-origin.
CORS becomes optional in this shape (same-origin has no CORS restriction to satisfy), but
decision 034's `CORS_ORIGIN` allowlist code and its test stay in place as defensive code — it
does no harm same-origin, and protects if a second origin (e.g. a future separate admin
frontend) is ever added. One Render service instead of two also means one warm-up curl instead
of two, one URL to hand Ali, one CNAME target instead of reasoning about which of two hosts the
domain should point at, and the backend can go back to Render's **free tier** instead of
Starter (decision 003's cost reasoning no longer applies once there's no second cold-start-prone
service to worry about relative to a paid one — free tier's cold start is the same regardless
of shape, but there is now only one service's cold start to manage, not two, so the Starter-tier
justification from decision 003 weakens; still worth a warm-up curl before Ali's demo either
way, per the existing checklist step).

## What this rests on

That relative `/api/*` fetches and no client-side routing describe the app as it actually is
today, not an assumption — both confirmed by grep above, not guessed.

## What would make this wrong

If the frontend later grows client-side routing (react-router or similar) with deep links,
`express.static` alone will 404 on a hard refresh of any non-root route — that needs an Express
catch-all (`app.get("*", ...)` serving `index.html`) added at that point. Not present today, not
built speculatively here. If a second, genuinely separate frontend origin is ever added (e.g. an
internal admin tool on its own domain), decision 034's CORS allowlist is exactly the mechanism
that would need a real second entry — already in place, not something to re-derive.
