# 030 — Repo name, visibility, and history strategy for the GitHub push

**Date:** 2026-08-21
**Story:** REPO (Basecamp to-do: "Record where the TalentSignal code lives")
**Requirement:** unblocks S-19 (CI has never run on GitHub — no remote configured) and S-20
(deploy needs a GitHub-hosted repo)
**Decided by:** Megan (PROPOSED — pending Ali; the actual GitHub creation/push is a human step
run by Megan, not automatable)

## The question

`C:\dev\talentsignal` has 62 local commits and no git remote. Before pushing to GitHub for the
first time, four things needed a real answer, not a silent default: what to name the repo,
public or private, whether to push the full 62-commit history or start fresh/squashed, and
whether anything currently in the tree or its history is unsafe to make visible on GitHub.

## Options considered

**Visibility:**
1. Public — more typically "reviewable" for a grading context.
2. Private — chosen. `GAME_PLAN.md` (tracked since day one) contains candid self/course
   assessment written for Megan and Ali, not a public audience; nothing in it is wrong or
   embarrassing, but it wasn't written with a public GitHub audience in mind.

**History strategy:**
1. Push full history — chosen. A pre-push audit (below) found nothing sensitive anywhere in the
   62 commits, so there's no security reason to rewrite it, and it's the actual incremental
   record — story by story, decision by decision — that supports "can Megan defend this" as the
   grading model.
2. Start fresh / squash — rejected. Loses that incremental record for no remaining benefit once
   the audit came back clean, and rewriting history this close to the S-20 deadline is pure risk
   (force-push mistakes) with nothing to show for it.

**Repo name:** `talentsignal` — matches the project name and the deploy subdomain
(`talentsignal-demo.colaberry.dev`) without stuttering.

## What we chose, and why

Private repo named `talentsignal`, pushed with full history, default branch `main` (already the
local branch name). Plain English: nothing found in the audit needs hiding, so the only real
question was "reviewable by strangers" vs. "reviewable by the people actually grading/approving
this" — private matches an intern project better by default, and is trivially reversible
(GitHub repos can be flipped public later) whereas squashing history is not.

## Pre-push audit findings (folded into this decision, not a separate doc)

- **No secret tracked, now or in history.** Checked `git log --all --diff-filter=A --name-only`
  across all 62 commits (no `.env`/`*.pem`/`*.key`/credential-shaped filename beyond
  `.env.example`) and `git log --all -p` full-content grep for `JWT_SECRET=`,
  `ADMIN_BOOTSTRAP_PASSWORD=`, `postgres://user:pass@`, AWS-key and PEM-header patterns with real
  values attached (only match: a doc line reading the literal placeholder `<value from .env>`).
  `.env.example` itself has every sensitive field blank.
- **`login.json`/`nouser.json`/`reg.json`/`wrongpw.json` (repo root, tracked since S-02)** contain
  a plaintext test password (`DemoPassword123`) for a local-only demo account. Not a real secret
  — doesn't match any actual credential, the account never existed outside a throwaway local DB —
  but credential-shaped and worth cleaning up. Left as a fast-follow (see below), not blocking
  the push.
- **`.gitignore` confirmed to cover** `node_modules/`, `dist/`/`build/`, `*.log`, `.env`+`.env.*`
  (with `.env.example` explicitly un-ignored), `pgdata/`/`postgres-data/`. Added
  `backend/scripts/load-test/results/*.log.*` in this same change, since the existing `*.log`
  rule doesn't match the `.contaminated`/`.crashed` compound extensions S-18's load-test harness
  produces on a bad run.
- **Documentation-accuracy note (not a security finding):** `05_presentations/S-18-summary.md`
  states `run-default-pool.log`/`run-pool20.log` are "checked in as evidence," but both actually
  match `*.log` and were never committed — only their timestamped JSON counterparts are tracked.
  Flagged for a future one-line correction; out of scope for this decision to fix.

## What this rests on

That a grep-based audit across full history content and filenames is sufficient to catch any
committed secret — reasonable here since the project has consistently used environment variables
for all real secrets from S-02 onward (per `CLAUDE.md`'s "no secrets in the repo, ever" rule),
and the audit found the pattern held for all 62 commits, not just recent ones.

## What would make this wrong

- If Ali or the course explicitly requires a public repo for grading/review purposes — flip
  visibility (cheap, reversible on GitHub).
- If the `login.json`-family cleanup is skipped today and later needs doing anyway — it's a
  standalone `git rm` commit, not a history rewrite, so it can happen at any point without
  disturbing anything else.
- If a future contributor's commit accidentally includes a real secret — the audit method above
  (full-history content grep) is the right first check before any future push, not a one-time
  exercise.
