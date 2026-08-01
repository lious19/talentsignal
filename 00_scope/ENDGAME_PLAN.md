# Endgame Plan — S-09 to S-20
Written Sat 2026-08-01. 8/23 done. 12 stories, 20 days to the Aug 21 deadline.

## Where you stand
- Done: R0 (S-01–03), R1 (S-04–07), and S-08 (opens R2). Posted on Basecamp.
- Next due: S-09, Tue Aug 4. You have the weekend as buffer — ~2 days ahead.
- Pace required: 12 stories / 20 days ≈ one story every 1.6 days. The current one-a-day
  rhythm holds this comfortably **if nothing derails.** Protect the buffer.

## The single highest-leverage action this weekend: reconnect with Ali
Ali has approved **zero** phase gates and left no recent comment. He said "keep moving,
out a week" back on Jul 22 — he should be back now. Three things need him, and the third
is the biggest risk in the whole project:

1. **Formally gate Phase 1 (R0 + R1).** It's done and posted; ask him to approve it so the
   process isn't silently skipped.
2. **Ratify the parked decisions** on `for-ali-when-back.md`: confidence weights (007),
   freeform pipeline transitions (014), field-level PII (009), the REQ-017/bcrypt conflict.
3. **DEPLOYMENT — do this now, not in week 3.** S-20 deploys to
   `talentsignal-demo.colaberry.dev`. Who provisions that host? Do you have credentials?
   Every story's definition of done ends with "runs in the deployed demo" — if hosting
   isn't sorted, S-20 stalls at the finish line and that DoD clause is never met for
   *anything*. This is the one task you cannot build solo, and it's scheduled last. Resolve
   access three weeks early so it can't sink the deadline.

Send one consolidated message covering all three.

## The map of what's left, by risk

**R2 remainder — human-in-the-loop**
- **S-09 (Aug 4) — THE KEYSTONE.** AI-drafted opportunity packages under human release
  (REQ-005 + REQ-020, the rule that overrides everything). This is what every "no-outbound"
  test you've written has been prefiguring — they're designed to flip here. Highest
  philosophical weight in the project. Give it the most careful planning pass. Don't rush it.
- S-10 (Aug 5) — Warm Relationship Identification. Surface relationships for intros, with a
  confirm step. Moderate.
- S-11 (Aug 6) — Recommendation Engine with a feedback loop. Moderate.

**R3 — analytics, trust, compliance**
- S-12 (Aug 7) — KPI dashboard. 🧑 First real UI-heavy story — this is where the interface
  gets visual. Ties into your "when does it look like a product" question.
- S-13 (Aug 11) — Demand forecast with confidence intervals. Moderate.
- **S-14 (Aug 12) — RBAC. THE DANGER STORY.** Role-based access enforced on every route.
  Deferred repeatedly ("don't build S-14 early") — now it lands and touches everything
  you've built. Highest regression risk of any remaining story. Budget extra verification;
  re-run the full suite after.
- **S-15 (Aug 13) — Privacy + Audit formalization. 🧑 YOUR VICTORY LAP.** This reads the
  S-05 PII registry and S-08 audit trail you built correctly. Because you did the
  foundations right, this should be a *read, not a retrofit* — the payoff of all that care.
- S-16 (Aug 14) — CRM Pollution Prevention: dedupe, guard writes, rollback. Moderate.
- S-17 (Aug 17) — Anomaly detection + segmentation. **Could-haves** (lowest MoSCoW
  priority). If time gets tight, this is the first place to trim scope — with Ali's ok.

**R4 — launch**
- **S-18 (Aug 19) — Performance/load. CANNOT be done literally.** 1000 concurrent users at
  p95 <200ms is impossible on your machine. Build the harness, measure what the machine
  allows, report the real numbers honestly, extrapolate transparently. Do not fake it.
- S-19 (Aug 20) — E2E tests, seed data, CI pipeline. Infrastructure. Formalizes the seed
  data you've been faking per-story.
- **S-20 (Aug 21) — DEPLOY. 🧑 Blocked on Ali's hosting (see above).** The finish line.

## The three real risks to the deadline
1. **S-20 deploy blocker** — biggest. Mitigate by resolving hosting/credentials with Ali
   THIS WEEKEND, not in week 3.
2. **Ali disengaged** — no gates, no answers. Mitigate by reconnecting now; you need him for
   deploy and for ratifying decisions.
3. **Your machine** — 7 GB RAM, every DB-heavy story strains it (S-14, S-18, S-19 will be
   heavy). Mitigate: close Edge and stop unused services before those sessions; keep the
   pattern of committing early so a crash costs nothing.

## Operating approach for the run-in
- **Keep one story at a time, top to bottom.** The discipline caught every real defect. Do
  not batch to "save time" — batching is how the trap (approving without understanding)
  creeps back.
- **Plan-first, then build, then verify.** Same loop that's worked for 8 stories.
- **Re-pull each story live from Basecamp before building it.** Standing commitment.
- **Verify DB-gated trust scenarios against a real database** (S-14, S-15, S-16 will each
  have one) — a green fake-pool run doesn't prove them, as S-08 showed.
- **Protect the ~2-day buffer.** Don't let S-14 eat it. If S-17 (could-have) needs to be
  cut for time, that's the one to cut — with Ali's sign-off.

## The one-sentence version
Reconnect with Ali this weekend to unblock deployment and ratify the parked decisions, then
run S-09→S-19 one story a day at the pace that's worked, treating S-09 (keystone), S-14
(regression risk), and S-18 (can't-be-literal) as the three that need special handling —
and keep S-20's hosting from becoming a last-minute surprise.
