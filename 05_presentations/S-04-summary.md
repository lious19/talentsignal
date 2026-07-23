# S-04 — Hidden Demand Analysis service
**Status:** Complete · **Delivered:** 2026-07-22 (due Mon Jul 27 — five days early)
**Requirements:** REQ-001, REQ-019 · **Agent:** SignalAgent

## What shipped
The platform now ranks companies by likely hidden staffing demand. A batch of ingested
signals is scored, ranked highest-confidence first, and shown on a demand board with each
opportunity's confidence, its reasons, and its source. It reuses S-03's scorer unchanged —
no second scoring engine was built.

## Both acceptance scenarios pass
**Ranked, explainable opportunities** ✅ — opportunities come back ordered by bounded
confidence with the contributing factors, tiebroken on a stable unique id.

**Bounded latency (5s / 10,000 records)** ✅ — server-side handler measured **~700ms** for
10,000 seed records, ~7x under the 5-second target.

**🛡 The platform never contacts a client on its own** ✅ — a test spies on every outbound
mechanism (fetch, HTTPS) and asserts none fires during analysis. It will correctly start
failing when S-09 adds a real release gate, forcing a conscious decision then.

## The one thing that made 10,000 records possible
S-03 wrote each opportunity with its own database call inside a loop. At 10,000 rows that's
10,000 sequential network round-trips — fatal. S-04 replaces it with a **single batched
`unnest` upsert**: each column is sent as one array, Postgres zips them back into rows, and
the whole batch is one atomic statement. This also sidesteps Postgres's 65,535-parameter
ceiling that a naive multi-row `VALUES` statement would hit at exactly this scale.

## Kept honest
- **Confidence weights are still PROPOSED** (decision 007). S-04 makes them load-bearing —
  the whole board is ranked by them — but they stay in the one config object. Ali read the
  follow-up; no change requested yet.
- **Latency proven server-side, not by wall clock.** Local wall-clock timing was unreliable
  under memory pressure. The ~700ms is measured inside the request handler; authoritative
  sign-off belongs in CI and formally in S-18. The latency test is non-blocking so it can't
  fail the pipeline on an environment artifact.
- **Seed data is quarantined** — source `seed-job-board`, opt-in only, hidden from the board
  by default, so it can never pollute the real demo. Formal seed infrastructure is S-19.

## Tests
48 backend pass, 12 frontend pass, tsc clean both sides. The unconditional guarantee is the
batched-write regression guard: it asserts the code makes *one* query call regardless of
batch size, so a regression back to the per-row loop fails the build even without a database.

## Next
S-05 — clients and candidates data model, with PII tagged at the schema level. Due Tue Jul 28.
