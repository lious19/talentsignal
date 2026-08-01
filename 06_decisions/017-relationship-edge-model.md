# 017 — Relationship edge model: nodes, direction, search scope, and the opportunity↔client anchor

**Date:** 2026-08-01
**Story:** S-10
**Requirement:** REQ-006 ("should"), REQ-020
**Decided by:** Megan, confirmed with the class instructor standing in for Ali this
session — several judgment calls, not something Ali's build note specifies beyond
"lightweight relationship edges."

## The question

Ali's build note says "model lightweight relationship edges... render a confirm/dismiss
review." Four things had to be decided that the note doesn't specify:
1. What entities have edges — is there a "client contact" as a distinct person, or not?
2. Are edges directed or undirected?
3. When a rep opens an opportunity, does the search span the whole agency's relationship
   graph, or only the calling rep's own edges?
4. How does an opportunity (market-signal data, `company` as free text) anchor to a
   specific client (platform data, `clients.name`) to search from?

## Options considered

**Node model:**
1. **`users` ↔ `users`, and `users` ↔ `clients`.** Reuse the two entities that already
   have real ids. A "client contact" is modeled at the company level via `clients` — the
   only client-side entity that exists.
2. Add a new `client_contacts` table (id, client_id, name) so edges can point at a named
   person, not just the company. More realistic, but new schema `S-10`'s own "keep it
   lightweight" note doesn't ask for.

**Search scope:**
1. **Search the whole edge graph** — any user's relationship counts, not just the caller's.
2. Search only the calling rep's own edges.

## What we chose, and why

**Node model: option 1.** Same honesty-over-invention discipline as
`06_decisions/015`'s opportunity↔job call: `client_contacts` would be new, unrequested
schema for a "should," not a "must," story that explicitly says not to over-engineer.
Company-level `knows_contact` edges are a reasonable first pass — "someone at the agency
has SOME relationship into this account" is still useful signal even without naming which
person at the client it is. If Ali wants person-level contacts later, that's a new table
and a `client_contacts` node type, additive, not a redesign of `relationship_edges`.

**Direction: undirected storage.** A `'colleague'` edge has no meaningful direction, and
even `'knows_contact'` is always queried from the client side regardless of which column
it was inserted into. Storing one row and checking both `(from_id)`/`(to_id)` in queries
avoids doubling every symmetric relationship into two rows — simpler, and there's no
case in this story where direction carries information worth keeping.

**Search scope: option 1 (whole graph).** The entire value of a 2-hop path is "ask
Jordan, not you" — a colleague's direct relationship into a client is exactly the useful
case, and restricting search to the caller's own edges would silently hide the most
useful paths (anything requiring an intro through a colleague). Confirmed with the
instructor this session.

## Anchoring an opportunity to a client — the same no-FK gap as S-09

`opportunities.company` is free text from a market signal; `clients.name` is entered
independently by a rep. No FK relates them — the same gap `06_decisions/015` hit for
opportunity↔job. Unlike S-09, though, the route's contract
(`GET /api/opportunities/:id/relationships`, no other params) doesn't leave room for a
caller-supplied client id the way S-09's `POST` body did — Ali's slice names exactly this
one path with no query params. So the resolution here is different in kind: a
case-insensitive exact match, `lower(opportunities.company) = lower(clients.name)`. If
nothing matches, the endpoint returns `200 { client: null, paths: [] }` — a valid,
honest "no known relationships for this company yet" state, not an error.

### What this rests on

That a `clients.name` a rep entered will, most of the time, match the `company` string a
market-signal provider reports for the same real company, exactly (case aside). This is
the weakest link in the whole story and worth naming plainly: a typo, an abbreviation
("Acme" vs. "Acme Corp"), or a DBA name mismatch silently produces zero surfaced
relationships with no error to signal why. No fuzzy matching is implemented — that would
be real scope creep for a "should" story explicitly asked to stay lightweight.

### What would make this wrong

If Ali wants opportunities properly linked to clients (the same open question
`06_decisions/015` already raised for job openings), this whole heuristic becomes
unnecessary — a real `client_id` on `opportunities` would replace the name match
entirely, and this decision would be superseded, not revised. Flagged in
`07_meeting_notes/for-ali-when-back.md` alongside 015's equivalent gap, since a single
future story could plausibly resolve both at once.
