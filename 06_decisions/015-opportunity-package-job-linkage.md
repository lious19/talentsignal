# 015 — Opportunity packages: linking an opportunity to a job (and to erasure)

**Date:** 2026-08-01
**Story:** S-09
**Requirement:** REQ-005, REQ-020
**Decided by:** Megan, confirmed with the class instructor standing in for Ali this
session — this is a judgment call, not something Ali's build note specifies.

## The question

Ali's build note says PackageAgent "composes a proposal from opportunity + candidate
data," and the story explicitly says to reuse S-06's matching. But `opportunities`
(sourced from market signals — `source`, `external_signal_id`, `company`) and
`job_openings` (platform data entered by a rep, tied to a `client_id`) have **no existing
foreign key relating them** — nothing in the schema says "this opportunity is for that
job." S-06's matching is job-based (`scoreCandidate` ranks candidates against a job's
`requirements`), so composing a package needs a job to match against, and there's no way
to derive one from an opportunity alone.

A second question rode along: what happens to a *released* package's content on an S-15
erasure request, given it embeds a candidate's name?

## Options considered

For linking opportunity → job:
1. **Require both `opportunityId` and `jobOpeningId` explicitly** in the draft request —
   the rep names both; PackageAgent reuses `scoreCandidate()` in-process against that job
   and auto-picks the top N candidates.
2. **Require `opportunityId` + explicit `candidateIds`** — the rep runs
   `/client-matchmaking/match` separately first, eyeballs the ranking, and hand-picks
   which candidate ids to attach; PackageAgent does no ranking of its own.
3. Invent a new FK column on `opportunities` (or a join table) linking it to a
   `job_opening_id` at ingestion time, so a draft request only needs `opportunityId`.

## What we chose, and why

**Option 1.** The story's slice is one `POST /draft` call producing one drafted package —
Ali's build note describes PackageAgent doing the composing, not a human pre-selecting
candidates in a separate step first. Option 2 would turn candidate selection into a human
task that happens *before* drafting, which blurs where "AI drafts" ends and "human
decides" begins — the story's whole point is that the human's role is reviewing and
releasing a *complete* draft, not assembling its inputs. Option 3 invents a data
relationship that doesn't reflect how these two agents currently produce data
(SignalAgent scores market signals; a rep independently enters job openings) — that's a
bigger, unrequested schema change disguised as a small one, and CLAUDE.md rule 4 says not
to invent structure silently.

So the draft endpoint takes `{ opportunityId, jobOpeningId }`. `opportunity_packages`
stores both as required foreign keys.

## What this rests on

That a rep drafting a package already knows which job opening the opportunity should be
matched against — reasonable for a demo (one rep, small candidate/job pool) but worth
Ali's confirmation once there's a real workflow around *how* a rep discovers "this hidden
demand at Acme Corp probably means their open Backend Engineer role."

## What would make this wrong

If Ali wants opportunities to auto-suggest a job (or a real 1:1 relationship gets
established upstream, e.g. by a future story that ingests job-board signals *as* job
openings directly), this becomes a real FK and the draft request can drop
`jobOpeningId`.

## Open question for Ali — erasure of a RELEASED package's content

Registered in this migration (007): `opportunity_packages.content` is `reset_to_empty` on
an S-15 erasure request, same as any other column embedding a candidate's name. That's
uncontroversial for a package still in `draft` — it's disposable, unreleased AI output.
But a **released** package is a record of a human decision (who chose to send this
proposal, and what it said) — arguably closer to `sales_pipeline_audit` than to a
throwaway draft, and Ali may want it *retained*, not blanked, once released, for the same
"the record of what happened is the point" reason `sales_pipeline_audit.changed_by` is
`retain_exempt` (06_decisions/013).

Not decided here — flagging it as a genuine open question rather than picking silently. A
status-dependent erasure strategy (`reset_to_empty` while `draft`, something like
`retain_exempt` once `released`) is more than S-15's current generic `pii_fields` loop
supports (one strategy per column, not per row-state), so this may also need a small S-15
design change, not just an answer. Logged in
`07_meeting_notes/for-ali-when-back.md` too.
