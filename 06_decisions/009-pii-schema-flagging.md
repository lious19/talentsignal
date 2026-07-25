# 009 — PII schema flagging: registry structure, and what's PII vs what's hidden

**Date:** 2026-07-25
**Story:** S-05
**Requirement:** REQ-012 (forward-looking, feeds S-15)
**Decided by:** Megan (registry mechanism + display-vs-erasure split); Megan,
2026-07-25, this session (field-level vs whole-record gating — see below)

## The question

Two questions, initially conflated in the first draft of this plan:

1. How is PII "flagged at the schema level," in a way S-15 can actually query and
   act on (access requests, erasure requests) — not a comment someone has to
   remember?
2. S-05's own trust scenario needs *some* PII hidden from non-recruiter/admin
   roles *today*. Does that mean the same set of columns as (1), or a different one?

The two turned out not to have the same answer, and answering them with one flag
instead of two was the actual mistake in the first pass at this decision.

## Options considered (for the tagging mechanism)

1. Column comments (`COMMENT ON COLUMN ...`) — queryable via `pg_catalog.pg_description`,
   but carries no structured metadata and nothing forces a new PII column to get one.
2. A naming convention (`pii_contact_info`) — trivially queryable, but same problem:
   no metadata beyond the fact itself, and no enforcement.
3. A structured `pii_fields` registry table, seeded in the same migration that adds
   the PII columns.

## What we chose, and why

Option 3, with two columns per row instead of one boolean:

```sql
CREATE TABLE pii_fields (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  category TEXT NOT NULL,
  erasure_strategy TEXT NOT NULL,        -- what S-15 executes on an erasure request
  redact_from_display BOOLEAN NOT NULL,  -- what S-05's own response-shaping reads today
  PRIMARY KEY (table_name, column_name)
);
```

Seeded rows: `clients.contact_info` and `candidates.contact_info` (both
`reset_to_empty`, both `redact_from_display: true`), and `candidates.name`
(`anonymize`, `redact_from_display: false`).

`clients.name` is deliberately **not** registered — it's a client *company* name,
not personal data. `candidates.name` **is** registered, because it's a person's
name, even though it must stay visible in every authenticated API response today.

`erasure_strategy` values are `reset_to_empty` / `anonymize`, not literal SQL
`NULL` — both `contact_info` and `name` are `NOT NULL` columns, so an erasure
strategy that means "set to NULL" would violate the constraint it's describing.

**Why this split matters, concretely:** if `candidates.name` isn't registered as
PII at all (the first draft's mistake), an S-15 erasure request that loops over
`pii_fields` will erase `contact_info` and leave the person's actual name sitting
in the database, untouched, forever — the exact retrofit disaster Ali's build note
warns this story exists to prevent. Registering it as PII, but with
`redact_from_display: false`, is what lets S-15's erasure path and S-05's own
display gating disagree on purpose, instead of one flag forcing them to agree by
accident.

## What this rests on

- S-15 will read `pii_fields` generically (one loop, not a hardcoded column list)
  for both access and erasure requests.
- `contact_info` is flagged wholesale — JSONB sub-key granularity (e.g. flagging
  `contact_info->>'email'` specifically) is out of scope for S-05.

## What would make this wrong

If Ali, on return, reads S-05's trust scenario ("PII columns... access is
role-gated") as whole-record gating rather than field-level, the gating design in
`backend/src/routes/clients.ts` / `candidates.ts` needs revisiting, and S-06's
candidate-read path (any authenticated role, by design) would need its own
explicit exemption. That specific call — field-level vs whole-record — was put to
Megan directly this session (not decided in advance, not something Ali had already
signed off on) precisely because S-06 is due 3 days after S-05 and needs any
authenticated role to read `candidates.name`/`skills` for matchmaking. Logged here
for his eventual ratification; see `07_meeting_notes/for-ali-when-back.md`.
