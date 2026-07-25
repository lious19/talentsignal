# S-06 — Client Matchmaking (MatchAgent)
**Status:** Complete · **Delivered:** 2026-07-25 (due Wed Jul 29 — four days early)
**Requirements:** REQ-002, REQ-020 · **Agent:** MatchAgent

## What shipped
Given a job opening, the platform ranks the candidate pool by fit and shows why. Each
candidate's score comes from Ali's prescribed method — cosine-style similarity on skills
overlap — combined with a normalized, saturating experience factor. Every score shows which
skills matched, not a bare number, same transparency bar as S-03/S-04.

## Both acceptance scenarios pass
**Ranked candidates with a fit score** ✅ — `POST /api/client-matchmaking/match` returns
candidates ordered by fit score descending, tiebroken on candidate id for determinism.

**🛡 A human decides, the platform suggests** ✅ — the response carries `suggestion: true`,
and a trust test spies on every outbound mechanism (fetch, HTTPS) and asserts none fires
during a match. There is no "submit to client" endpoint anywhere in the codebase — that's
S-09's human-release gate. The test will correctly start failing when S-09 adds one, forcing
a conscious decision then, same pattern as S-04's no-outbound test.

## The cosine math, in one line
Skills are 0/1 (present/absent), so cosine similarity collapses to
`|shared skills| / sqrt(|candidate skills| * |job requirements|)` — the Ochiai coefficient.
No vocabulary or vector needs to be built; it's pure set arithmetic.

## The judgment call, caught and fixed during planning
A first-draft additive blend (`skillsScore*0.7 + experienceScore*0.3`) let a candidate with
**zero** matching skills but high experience outrank one with a real, if weak, skill match —
the wrong ranking for a skills-first tool. Fixed by combining **multiplicatively**
(`fitScore = skillsScore * (0.7 + 0.3*experienceScore)`), which guarantees zero overlap always
scores zero, so experience can only ever boost a real skill match, never substitute for having
none. Logged as decision 011, PROPOSED pending Ali — both the weight split and this
combination shape are judgment calls, not something Ali specified.

## Kept honest
- **`availability` is display-only, not a filter.** It's free text with no defined
  vocabulary — inventing filter semantics on it would be exactly the silent assumption
  CLAUDE.md rule 4 forbids. Shown to the recruiter on every candidate; logged as an open
  question for Ali in decision 011.
- **`contact_info` never appears in a match response, for any role** — stricter than
  `candidates.ts`, which shows it to admin/recruiter. This endpoint's job is ranking, not
  contact lookup; a dedicated test locks this in across every role.
- **`rankDriver` says what's actually true, not what sounds tidy.** Under these weights,
  skills structurally always contributes more than experience to a nonzero score — so a rank
  is never "driven by experience." The label instead says whether experience added anything
  on top of a real skill match (`skills-only` vs `skills-plus-experience`), never implying a
  contest experience can't win.
- **Latency proven server-side, not by wall clock** — same non-blocking, opt-in pattern as
  S-04's AC-4-2 test, gated behind `RUN_TIMING_TESTS=1` + `DATABASE_URL`.

## Tests
105 backend tests pass, 7 skipped (opt-in DB/timing tests, unchanged behavior) — 22 of the
passing tests are new: `matchScore.test.ts`'s cosine/combination math (12), route-level happy
path/404/400/500/idempotency/ranking-inversion guard (6), dedicated PII lock-down across all
three roles (3), and the no-auto-submit trust test (1) — plus one new opt-in AC-4-3 latency
test (skipped by default, same as S-04's). 15 frontend tests pass, 3 new for `MatchScreen`.
tsc clean both sides. No lint script is wired up in this repo yet.

## Next
S-09 — the human-release gate. This story's no-auto-submit trust test is written to fail the
moment that lands, which is the intended trigger to replace it with a positive assertion.
