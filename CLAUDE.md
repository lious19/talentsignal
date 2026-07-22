# TalentSignal Revenue Engine — Project Context for Claude Code

**Read `00_scope/scope.md` first. It is the authoritative captured spec.**
Canonical source of truth is Basecamp:
https://app.basecamp.com/3945211/buckets/24865175/todolists/10116038052

## Who
- **Builder/owner:** Megan (Colaberry intern). Strong Python + SQL. **Less fluent in
  JS/TS/React — explain front-end and Node code more thoroughly than you normally would.**
- **Client:** staffing-agency sales users (Colaberry sales team, Boston, as proxy).
- **Approver:** Ali Muwwakkil — 3 phase gates.
- **Deadline:** 2026-08-21. 20 stories, R0→R4.

## What this is
A **full-stack cloud web application**, not an analysis project.
React + Node/Express + PostgreSQL + Docker Compose + GitHub Actions CI, deployed to
https://talentsignal-demo.colaberry.dev. External providers **mocked behind adapter seams**.

## The rule that overrides everything
> The AI drafts and suggests; a human reviews and releases anything that would leave the
> platform or write to a client CRM. **Enforce in code (REQ-020), not by convention.**

## Rules of engagement for Claude Code
1. **Explain before you build.** Before each story, state in plain English: what it does,
   what assumption it rests on, what would make it wrong. Megan defends this live in class.
2. **Explain the JS/TS specifically.** Megan reads Python fluently and JS less so. When you
   write React hooks, Express middleware, async patterns, or TS types, walk through them.
3. **One story at a time, top to bottom.** Do not start a release until the previous
   release's demo runs. Do not build ahead.
4. **No silent assumptions.** Scoring weights, thresholds, segment definitions, confidence
   formulas are **business decisions**. Stop and ask. Log them in `06_decisions/`.
5. **Heuristic first.** Ship a transparent, explainable heuristic behind a service boundary.
   Do not reach for ML. A trained model must be able to replace it without touching callers.
6. **Trust scenarios are not optional.** Every story has one (see TBI primer in scope.md).
   A story is not done until its trust scenario passes.
7. **No secrets in the repo.** Environment variables only. Ever.
8. **Timeouts and correlation ids.** Every outbound HTTP/DB/queue call gets an explicit
   timeout. All logs are structured JSON with a correlation id.

## Definition of done (every story)
Acceptance scenarios pass, **including the trust scenario** · tests cover happy path +
failure + idempotency · tsc/lint clean · no secrets · **runs in the deployed demo**.

## Repo layout
`/frontend` and `/backend` are **Ali's naming, from the S-01 build note — do not rename them.**
```
00_scope/           Captured spec. START HERE.
00_scope/stories/   Per-story acceptance criteria pulled from Basecamp. S-01.md, S-02.md, ...
06_decisions/       Decision log. One entry per business-logic choice. Megan's own words.
07_meeting_notes/   Ali + instructor conversations.
05_presentations/   Weekly class demo material.
frontend/           React front end
backend/            Node/Express API
  backend/db/         SQL migrations (PostgreSQL) + migrations runner
  backend/adapters/   Mocked external provider seams
tests/              Unit, integration, E2E
docker-compose.yml
```

## Before building any story
Read `00_scope/stories/S-XX.md` for that story. It contains the verbatim Gherkin
acceptance criteria and Ali's build note. Those are the loop stop — not your own plan.

## Status
- [x] Scope captured → `00_scope/scope.md`
- [ ] Open questions answered by Ali (see bottom of scope.md) — **BLOCKING**
- [ ] S-01 Walking skeleton — OVERDUE (was due Jul 21)
- [ ] S-02 Auth — DUE Jul 22
