# Game Plan — TalentSignal Revenue Engine
Rewritten 2026-07-22 against the actual Basecamp spec. Supersedes the earlier draft.

---

## Honest assessment

**The spec is unusually good.** Ali has done work most clients never do: stable requirement
IDs, a clean agent/bounded-context map, releases that are genuinely thin end-to-end slices,
and a trust doctrine that's specific enough to test. R0 is a real walking skeleton. You are
not being asked to invent the project — you are being asked to execute a well-specified one.
That is a large advantage. Do not squander it by improvising.

**The schedule is the problem.** 20 stories, ~22 working days, one story per day, zero
slack. You are already one story behind (S-01 was due Jul 21; nothing is checked off).
A single two-day rabbit hole in week 1 compounds through R4.

**The stack mismatch is the second problem.** You told me Python + SQL. This is React,
Node/Express, and TypeScript. Your SQL carries over and matters — the data model, the
append-only audit constraint, migrations, query performance are all yours. But you will be
approving JavaScript you're less fluent in, and the entire grading model is "can Megan
defend this in front of a class." Name this to yourself now and budget for it.

**Three requirements are not literally achievable and shouldn't be read literally:**
- REQ-017 (p95 <200ms at 1000 concurrent users) — a real 1000-user load test needs
  infrastructure you won't have. S-18 says "load *validation*." Build a k6/Artillery
  harness, run what your laptop supports, report measured numbers and extrapolate honestly.
- REQ-012 (GDPR/CCPA) — compliance is a legal posture, not a feature. You are building
  compliance-*shaped* features: consent gates, PII tagging, access/erasure endpoints.
  Say exactly that in your presentation. Claiming "GDPR compliant" is a claim you can't defend.
- REQ-001 (≥70% hidden-demand accuracy) — accuracy against *what ground truth*? With
  mocked providers there is no real label set. Either you construct a labeled fixture set
  and measure against it (defensible) or you drop the number (also defensible). What is not
  defensible is asserting 70% with nothing behind it.

Confirm all three with Ali rather than deciding unilaterally. They're his calls.

---

## What to do in the next 24 hours

1. **Send Ali the open-questions list** (bottom of `00_scope/scope.md`). Six questions, the
   sharpest being: the phase-gate dates contradict the story dates. Gate 1 is dated Jul 21;
   the R1 stories it gates run to Jul 30. Send today — every day you wait is 3% of the project.
2. **Open each Basecamp to-do individually.** The list view hides the per-story Gherkin
   acceptance criteria, build notes, and trust scenario. That detail is the actual
   specification. Read S-01 through S-03 fully before writing a line of code.
3. **Start S-01 today.** Docker Compose + React + Express + Postgres + healthcheck +
   structured logging. This is the most mechanical story in the project and the one Claude
   Code will do best. Do not let it take two days.
4. **Decide TypeScript vs JavaScript** — the DoD says "tsc clean," which implies TypeScript.
   Confirm with Ali. This decision is expensive to reverse at week 3.

---

## Operating rhythm

Story-per-day is the pace, so the loop is daily, not weekly:

| | |
|---|---|
| **Morning** | Read the story's full Basecamp detail. Have Claude Code explain its plan *before* building. |
| **Build** | One story. Do not build ahead into the next one. |
| **Verify** | Run the acceptance scenarios yourself. Run the trust scenario. Break it on purpose. |
| **Log** | Any business-logic choice → `06_decisions/`, in your own words. |
| **Close** | Check the Basecamp to-do. If it slipped, say so in Basecamp same-day. |

Fridays: build the class presentation from what actually runs.

### The rule that protects you
> Nothing gets checked off in Basecamp that you cannot explain on a whiteboard, without notes.

If Claude Code produces something you don't follow, that is a signal to stop and have it
explained — not to approve and move on. Your instructor described your role as approving
what Claude Code produces. Approval without comprehension is rubber-stamping, and it comes
apart in about ninety seconds of Q&A.

---

## Presentation structure (per release)

Five beats, ~5 minutes. Lead with the sales problem, never with architecture.

1. **Tension** — a staffing salesperson finds out about demand only when a client asks. By
   then they're competing on price against three other agencies.
2. **Move** — what shipped this release, and the one key decision behind it.
3. **Evidence** — live demo of the running app. Real output. Not slides of code.
4. **Trust** — which TBI rule this release makes real. This is your differentiator and Ali
   clearly cares about it; make it a standing beat.
5. **Honesty** — what's unproven, what's mocked, what's next. Naming your own weaknesses
   pre-empts the hardest question in the room.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Already one story behind, zero slack | **High** | Start S-01 today. Flag slippage in Basecamp same-day, never silently. |
| JS/TS fluency gap vs. "defend it live" | **High** | Daily explain-before-build. Ask Claude Code to walk through unfamiliar patterns line by line. |
| Deploy blocked on credentials/domain | **High** | Ask Ali *now*, not in week 4. S-20 fails hard if hosting isn't sorted. |
| Gate dates contradict story dates | Medium | Question 1 to Ali. |
| Gold-plating the ML | Medium | Heuristic behind a service boundary. The spec explicitly permits this — use it. |
| Undefined scoring weights invented silently | Medium | These are Ali's decisions. Ask, then log in `06_decisions/`. |
| Late-project compliance/audit work (S-15) | Medium | Tag PII in the *first* migration (S-05), as TBI rule 7 requires. Retrofitting is far worse. |
| Load/perf claims you can't back | Low | Measure what you can, report honestly, don't extrapolate silently. |

---

## The one-sentence version

Execute a well-specified plan at one story per day, understand every line you approve, ask
Ali the six open questions today, and present trust as the headline feature rather than
an afterthought.
