# 020 — Analytics KPI definitions, and no Analytics table

**Date:** 2026-08-01
**Story:** S-12
**Requirement:** REQ-009
**Decided by:** Megan — PROPOSED, pending Ali's approval. Ali flagged this story 🧑 HUMAN
explicitly: the KPI definitions are business judgment, not a code decision, and he's out,
so these are logged the same way decision 007's confidence weights were — a considered
proposal, not a settled answer, presented for the class gate to confirm or veto.

## The question

S-12 needs three numbers computed from real data: placements per month, time-to-hire,
and demand score. None of the three has a definition anywhere in the spec beyond a name —
exactly the kind of business judgment CLAUDE.md rule 4 says to propose and log, not invent
silently.

## KPI 1 — Placements per month

**Definition:** a placement is counted every time a pipeline transitions TO `closed` —
every `sales_pipeline_audit` row where `to_stage = 'closed'` — grouped by the calendar
month of `changed_at`.

### Options considered
1. **Event-based**: count every closing, however many times a client closes. A client
   that closes, reopens (freeform transitions, decision 014), and closes again counts as
   TWO placements, dated by when each closing actually happened.
2. **Snapshot-based**: count each client once, at whichever month they most recently
   closed (`DISTINCT ON (client_id) ... ORDER BY changed_at DESC`). A reopen-then-reclose
   moves the placement to the new month instead of adding a second one.

### What we chose, and why
Option 1, event-based. "Placements per month" reads most naturally as an activity metric
— how many closings happened each month — not a snapshot of who's currently sitting in
`closed` right now. This also reuses `sales_pipeline_audit` exactly as it's meant to be
read: an append-only log of things that happened, not a table to `DISTINCT ON` into a
current-state view (that's what `sales_pipeline` itself already is).

### What this rests on
That a genuine re-close (a client who churned and came back, then closed again) really is
a second placement worth counting — not double-counting a single deal. Confirmed as the
intended reading this session.

### What would make this wrong
If Ali means "how many clients are we CURRENTLY sitting on as closed," that's option 2 —
a one-line SQL change (`DISTINCT ON`), not a redesign.

## KPI 2 — Time-to-hire

**Definition:** for each placement event above, the number of days from that client's
**very first** `sales_pipeline_audit` row (when they entered the pipeline at all,
regardless of what stage) to that specific `to_stage = 'closed'` row. Averaged across
every placement event — the same event-based reading as KPI 1, so a client closed twice
contributes two measurements, both dated from the same original entry point.

This is exactly where the S-08 audit foundation pays off, as the story calls out
explicitly: `sales_pipeline` itself only ever tells you the CURRENT stage, never when a
client entered — only the append-only audit trail has that.

### Known, accepted edge case
If a client's first-ever audit row IS itself a `closed` row (entered the pipeline already
closed — legal under freeform transitions), time-to-hire computes to `0` for that
placement. That's an honest consequence of using the audit trail as the sole source of
"when they entered," not a bug — worth naming so it doesn't read as broken in a demo.

### What this rests on
That "time-to-hire" means "time in our pipeline, start to finish," not some other
interval (e.g. time from job opening posted to placement, which would need a different
join entirely and isn't derivable from the audit trail this story was told to use).

### What would make this wrong
If Ali means time-to-hire should start from something else (a job opening's creation
date, a candidate's application date), this becomes a different query against different
tables, not a tweak to this one.

## KPI 3 — Demand score

**Definition:** the average `confidence_score` across `opportunities`, excluding
`source = 'seed-job-board'` — the same "seed rows are demo/test-only, hidden by default"
convention `hiddenDemand.ts`'s `includeSeedData` filter already established, so this
number can't be silently skewed by thousands of synthetic rows if someone runs with
`MARKET_SIGNAL_PROVIDER=seed`.

### What this rests on
That a plain average, not a weighted or time-decayed one, is what "demand score" means at
this stage — the simplest reading, matching "correct before a fourth [KPI]," not a
sophisticated one.

### What would make this wrong
If Ali wants demand score weighted toward recent opportunities, or scoped per-client
rather than agency-wide, that's a different aggregate, not a redefinition of what
`confidence_score` itself means (S-03/S-07 own that).

---

## A DELIBERATE DEVIATION FROM ALI'S BUILD NOTE — no Analytics table

**This is flagged prominently, not as a footnote, because it directly contradicts what
Ali's build note literally says, and he should be able to veto it at the gate.**

Ali's build note: "Model an Analytics table, compute KPIs in the Node service..." with a
specific schema sketch (`analytics_id`, `client_id` FK, `date`, `demand_score`,
`placement_rate`). The story's own design-points section separately reopens this as a
judgment call ("store computed snapshots, or compute on the fly — keep it simple"), which
is the opening this decision uses — but the build note itself asked for a table, and this
decision does NOT build one.

### What we chose, and why
Compute all three KPIs on the fly, on every `GET /api/analytics` request, directly from
`sales_pipeline_audit` and `opportunities`. No `analytics` table exists in this story's
migration set.

**Reasoning:** all three KPIs are cheap aggregate queries (`GROUP BY`, `AVG`, a two-CTE
join) over tables that already exist and are already the source of truth. A snapshot
table would add a real problem this story's acceptance criteria never asks it to solve:
staleness. When does the snapshot refresh — on every write to `sales_pipeline` (a lot of
new triggers/hooks across several existing routes), on a schedule (needs a scheduler this
stack doesn't have), or on every `GET` (which defeats the entire point of a snapshot —
you'd be computing the live numbers anyway, then writing them somewhere nobody asked to
read them from)? Nothing in "KPIs render from real data" asks for point-in-time history —
only for the current numbers to be correct.

### What this rests on
That query performance stays fine without a snapshot at the data volumes this app
actually has — true today, and re-confirmable cheaply later (an `EXPLAIN ANALYZE`, not a
rearchitecture) if the audit trail grows into the millions of rows.

### What would make this wrong, and how to reverse it
**If Ali wants the table as specified, say so at the gate and this reverses cleanly**: add
a migration for the `analytics` table per his schema sketch, and change `analytics.ts` to
read from it instead of computing live. The KPI *definitions* above don't change either
way — only where the numbers get computed vs. stored. Also: if a future story needs
historical KPI trends ("what did demand score look like last quarter"), that is exactly
the moment a snapshot table earns its keep — additive then, not built speculatively now.
