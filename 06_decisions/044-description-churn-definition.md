# 044 — Description churn: title-or-description, 1 increment per fetch, normalized comparison

**Date:** 2026-08-30
**Story:** S-22
**Requirement:** ticket acceptance criterion 2 ("a requisition edited in place increments
churn without incrementing repost count") and its own boundary ("a whitespace-only edit
upstream should not count as churn")
**Decided by:** Megan, approved from a plan-mode research pass

## The question

What exactly counts as a `description_churn` increment, and how should title/description
text be compared across two fetches so upstream rendering noise doesn't get counted as a
real edit.

## What we chose, and why

**Title changed OR description changed, since the immediately prior fetch → +1.** Not per
field: if both change in the same fetch, that's still **+1, not +2** — one upstream edit
event (a team rewriting the posting), not "how many fields moved." The ticket's own framing
("a title or spec rewritten twice") is about edit events, not field deltas.

**Normalization: trim + collapse internal whitespace, strip HTML tags — NOT
case-insensitive.** A whitespace-only reflow or an HTML re-serialization (attribute order,
`&nbsp;` vs a plain space) is upstream noise and must not count, per the ticket's own
boundary. Case is deliberately preserved: a capitalization rewrite (adding "URGENT", or
"Data Analyst" → "DATA ANALYST") is a real, intentional edit a team made, not noise — a
salesperson reading "the team rewrote this posting" should see that.

## Concrete gap found in the current adapters, fixed as part of this story

**Greenhouse's board endpoint was called without `content=true`** — confirmed against the
live fixture (`gitlab.json`) and against the real, live API during this story
(`boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true`, verified 2026-08-30,
HTTP 200, 220 jobs, every job gained a `content` field; nothing else in the response shape
changed or broke). Without it, Greenhouse jobs carry no description text at all, so
Greenhouse's `description_churn` would silently only ever be title-churn. **Fix:**
`GreenhouseProvider.fetchBoard()`'s URL now requests `?content=true`.

**Greenhouse's `content` is HTML-entity-escaped, not raw markup** — a real, verified detail
this decision would have missed without the live check: the field's value is literally
`&lt;div class=&quot;...&quot;&gt;...`, not `<div class="...">...`. A naive
strip-`<[^>]*>`-tags regex does nothing to entity-escaped text. `normalizeChurnText()`
(`computeDiffs.ts`) decodes the handful of entities Greenhouse/Lever actually use
(`&lt; &gt; &amp; &quot; &#39; &nbsp;`) before stripping tags, so one normalization function
handles both sources correctly. Lever's `description` field, by contrast, is already raw
HTML (confirmed in `gopuff.json`) — decoding first is a no-op for Lever, harmless either
way.

## What this rests on

That the handful of HTML entities decoded (`&lt; &gt; &amp; &quot; &#39; &nbsp;`) covers
what Greenhouse's `content` field actually uses — verified against one real board's real
response, not the full space of every entity HTML permits. A posting using a less common
entity (e.g. `&mdash;`) would pass through `normalizeChurnText()` un-decoded, which is a
false-negative risk (an entity difference could register as churn when it's really the same
character), not a false-positive one — the safer failure direction for a "did something
change" heuristic.

## What would make this wrong

If Ali wants per-field counting (title and description changing in the same fetch = +2)
instead of per-event. If Ali wants case-insensitive comparison after all (treating
"URGENT" as noise, not signal). If a real Greenhouse or Lever posting is observed using an
HTML entity outside the decoded set, causing a false churn increment — the entity table in
`computeDiffs.ts` would need extending, not the overall approach revisited.
