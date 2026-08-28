# Onboarding

The next builder starts in minutes. This is the one page to read first.

## What TalentSignal is

A full-stack cloud web application, not an analysis project, for staffing-agency sales teams:
it surfaces hidden hiring demand from public job-market signals, ranks candidates against open
roles, and drafts outreach packages. External providers stay mocked behind adapter seams.

## Where the code lives

**https://github.com/lious19/talentsignal** — private repo, `main` branch. Ask Megan for
access.

## Where the deployed demo lives

**https://talentsignal.onrender.com** — Render free tier. It cold-starts after ~15 minutes
idle: `curl` `/health` once and give it a few seconds before demoing live. Data is synthetic
seed data only, reseeded via `npm run seed:demo` against the live database — never real client
data.

## Where the decisions live

`06_decisions/` — one numbered file per business-logic judgment call (scoring weights,
thresholds, segment definitions, security/deploy tradeoffs), each stating what it rests on and
what would make it wrong. 37 decisions on file as of S-20 (numbering has small intentional gaps
— a few reserved numbers were superseded or never needed once a gate passed clean).
`06_decisions/README.md` is the template and the open-items index — check it for anything still
awaiting Ali's answer before building on top of it.

## Where the story specs live

`00_scope/stories/` — per-story Gherkin acceptance criteria: `S-01.md` through `S-19.md`, plus
`HF-1.md`. No `S-20.md`, `HF-2`, or `HF-3` story file exists — those releases were built
directly from Ali's meeting notes and Basecamp comments, captured instead in the relevant
`06_decisions/` entries. `00_scope/scope.md` is the overall captured spec — read that first for
*what* the platform does.

## Where the presentations live

`05_presentations/` — per-story build summaries and demo evidence (screenshots, load-test
results), written for the weekly class demo.

## The six Basecamp Project Docs

Inside the "TalentSignal Revenue Engine – Project Docs" folder in Basecamp's Docs & Files:

- Docs Index & Agent Onboarding
- Requirements
- Architecture & Agent Map
- Trust (TBI) Primer
- Build Guide (per-release walkthrough)
- Traceability Matrix

No individual doc links are captured anywhere in this repo — linked from the S-20 to-do in the
BUILD list. The parent Basecamp project (todolist the spec was captured from) is:
`https://app.basecamp.com/3945211/buckets/24865175/todolists/10116038052`.

## Non-negotiables

From `CLAUDE.md` — these override anything else in this repo, including a plausible-looking
shortcut:

- **Heuristic first.** Ship a transparent, explainable heuristic behind a service boundary. Do
  not reach for ML. A trained model must be able to replace it without touching callers.
- **Adapter seams stay mocked.** External providers (job boards, CRM) are mocked behind adapter
  seams — no real outbound integration exists yet.
- **REQ-020, enforced in code, not by convention:** the AI drafts and suggests; a human reviews
  and releases anything that would leave the platform or write to a client CRM.
- **No secrets in the repo. Ever.** Environment variables only.
- **Timeouts and correlation ids.** Every outbound HTTP/DB/queue call gets an explicit timeout.
  All logs are structured JSON with a correlation id.

## Who to ask

- **Ali Muwwakkil** — approvals, business-logic decisions, phase gates.
- **Megan** — build owner.
