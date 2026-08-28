# TalentSignal Revenue Engine

A full-stack web application for staffing-agency sales teams: it surfaces hidden hiring demand
from public job-market signals, ranks candidates against open roles, and drafts outreach
packages — with a human required to release anything before it leaves the platform or writes to
a client CRM (see `CLAUDE.md`'s "rule that overrides everything").

React (Vite) frontend + Node/Express API + PostgreSQL, deployed to Render as a **single service**
(Express serves the built frontend's static assets alongside its own `/api/*` routes — see
`06_decisions/037-revert-to-single-service.md`), backed by Render's managed Postgres. Docker
Compose for local dev, GitHub Actions CI. Built as a Colaberry internship project (owner: Megan;
approver: Ali Muwwakkil) against the spec captured in `00_scope/scope.md`.

**Status:** R0–R3 stories complete; S-19 (E2E tests, seed data, CI gate) shipped 2026-08-21;
S-20 (deploy) live.

## Live demo

**https://talentsignal.onrender.com**

Render's free tier cold-starts after 15 minutes of inactivity — hit `/health` once and give it a
few seconds before demoing if it's been idle. Data is synthetic seed data only (see
`06_decisions/039-frontend-include-seed-data-for-demo.md`), reset via `npm run seed:demo`
against the deployed database, not real client data.

## Repo

**https://github.com/lious19/talentsignal** (private — ask Megan for access). See
`06_decisions/030-repo-visibility-and-history-strategy.md` for why private, full history.

## Architecture

- **Frontend:** React + Vite (`frontend/`)
- **Backend:** Node/Express API (`backend/`), routes under `/api/*`
- **Database:** PostgreSQL, SQL migrations run on boot (`backend/src/db/migrations/`)
- **Deploy:** one Render Web Service, built from the top-level `Dockerfile` — a multi-stage
  build that compiles the frontend (`vite build`) and backend (`tsc`) separately, then copies
  both into a single runtime image. Express serves `/api/*` and the built frontend's static
  files from that same process (decision 037). `backend/Dockerfile` still exists separately for
  local `docker compose` use only — Render does not use it.
- **External providers:** mocked behind adapter seams (`backend/src/adapters/`) — no real
  outbound integration exists yet; see `CLAUDE.md`.

## Local development setup

**Prerequisites:** Git, Node.js 20, Docker Desktop.

```bash
git clone https://github.com/lious19/talentsignal.git
cd talentsignal
```

**`.env` setup:** copy `.env.example` to `.env` and fill in real values. `NEW-CO_2.MD` (repo
root) has a working template with every value filled in for local/dev use — copy that block
directly if you have access to it. **The production `JWT_SECRET` and `ADMIN_BOOTSTRAP_PASSWORD`
have been rotated for the live Render deploy and are intentionally not in this repo, in
`.env.example`, or anywhere else committed** — generate your own local-only values (see
`.env.example`'s comments; `openssl rand -base64 32` for `JWT_SECRET`).

```bash
docker compose up -d --build
cd backend && npm ci && npm run seed:demo
cd ../frontend && npm ci && npm run dev
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`
- Postgres: `localhost:5433` (mapped from the container's 5432 — see `.env.example` for why)

**Login:** `admin@talentsignal.local` / (see your own `.env`'s `ADMIN_BOOTSTRAP_PASSWORD` — not
a fixed value, and not the same as whatever's set on the live Render deploy).

## Running tests

```bash
cd backend && npm test        # unit only — integration/E2E self-skip without DATABASE_URL
cd frontend && npm test
```

Set `DATABASE_URL` (pointing at a real, migrated Postgres — e.g. `docker compose up -d db`) to
also run the integration and end-to-end suites, matching what CI runs on every push.

## Deployment

See **[`ONBOARDING.md`](./ONBOARDING.md)** for the one-page orientation, and
`06_decisions/037-revert-to-single-service.md` / `038-database-ssl-reject-unauthorized.md` for
the Render-specific deploy details (env vars, managed Postgres SSL, trust proxy).

## Where to start reading

- **`CLAUDE.md`** — how an AI agent (or a new engineer) should operate in this repo: the
  human-release rule, one-story-at-a-time discipline, decision-logging requirement, definition
  of done.
- **`00_scope/scope.md`** — the captured spec. Start here for *what* the platform does.
- **`00_scope/stories/`** — per-story acceptance criteria (Gherkin): `S-01.md` through `S-19.md`,
  plus `HF-1.md`. (No `S-20.md`/`HF-2`/`HF-3` story files exist yet — those releases were
  synthesized from Ali's meeting notes and Basecamp comments directly; see the relevant
  `06_decisions/` entries for each.)
- **`06_decisions/`** — one entry per business-logic judgment call, in plain English, with what
  it rests on and what would make it wrong. `06_decisions/README.md` is the template + open-items
  index.
- **`05_presentations/`** — per-story build summaries and demo evidence (screenshots, load-test
  results), written for the weekly class demo.

## Repo layout

```
00_scope/           Captured spec + per-story acceptance criteria
06_decisions/        Decision log
07_meeting_notes/    Ali + instructor conversation notes
05_presentations/    Weekly class demo material, per-story summaries
frontend/            React front end
backend/             Node/Express API
  backend/src/db/      SQL migrations + migration runner
  backend/src/adapters/  Mocked external provider seams
  backend/tests/       Unit, integration, and E2E tests
Dockerfile           Top-level, multi-stage — what Render deploys (decision 037)
docker-compose.yml   Local dev only
.github/workflows/   CI (migrations -> unit -> integration -> E2E -> tsc -> lint)
```

## Who to ask

- **Ali Muwwakkil** — approvals, business-logic decisions, phase gates.
- **Megan** — build owner.
