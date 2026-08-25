# TalentSignal Revenue Engine

A full-stack web application for staffing-agency sales teams: it surfaces hidden hiring demand
from public job-market signals, ranks candidates against open roles, and drafts outreach
packages — with a human required to release anything before it leaves the platform or writes to
a client CRM (see `CLAUDE.md`'s "rule that overrides everything").

React + Node/Express + PostgreSQL, Docker Compose for local dev, GitHub Actions CI. Built as a
Colaberry internship project (owner: Megan; approver: Ali Muwwakkil) against the spec captured in
`00_scope/scope.md`. Deploys to `https://talentsignal-demo.colaberry.dev` (S-20).

**Status:** R0–R3 stories complete; S-19 (E2E tests, seed data, CI gate) shipped 2026-08-21;
S-20 (deploy) in progress.

## Repo
`<TBD once created — see 06_decisions/030>`

## Quickstart

```
cp .env.example .env
# fill in JWT_SECRET at minimum: openssl rand -base64 32
docker compose up
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`
- Postgres: `localhost:5433` (mapped from the container's 5432 — see `.env.example` for why)

Set `ADMIN_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` in `.env` to create one bootstrap admin account on
boot; leave both blank and none is created.

## Where to start reading

- **`CLAUDE.md`** — how an AI agent (or a new engineer) should operate in this repo: the
  human-release rule, one-story-at-a-time discipline, decision-logging requirement, definition
  of done.
- **`00_scope/scope.md`** — the captured spec. Start here for *what* the platform does.
- **`00_scope/stories/`** — per-story acceptance criteria (Gherkin), one file per story, S-01
  through S-20.
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
  backend/db/          SQL migrations + migration runner
  backend/adapters/    Mocked external provider seams
  backend/tests/       Unit, integration, and E2E tests
docker-compose.yml
.github/workflows/   CI (migrations -> unit -> integration -> E2E -> tsc -> lint)
```

## Running tests

```
cd backend && npm test        # unit only — integration/E2E self-skip without DATABASE_URL
cd frontend && npm test
```

Set `DATABASE_URL` (pointing at a real, migrated Postgres — e.g. `docker compose up -d db`) to
also run the integration and end-to-end suites, matching what CI runs on every push.
