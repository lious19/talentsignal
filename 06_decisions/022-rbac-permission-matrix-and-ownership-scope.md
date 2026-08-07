# 022 — RBAC permission matrix, and the scope of "ownership" (S-14)

**Date:** 2026-08-06
**Story:** S-14
**Requirement:** REQ-011
**Decided by:** Megan — PROPOSED, pending Ali's approval. S-14 itself calls the permission
matrix "a business decision — propose the matrix, log it, flag for Ali," same framing as
decisions 007, 009, and 020.

## The question

S-14 needs two things nobody had defined explicitly: (1) which of `admin`/`sales`/`recruiter`
may call each of the app's 30 route+method combinations, and (2) what "ownership" means for
the trust scenario ("a sales user is denied another user's resource unless they own it or
are admin"), given that most tables have no owner column at all.

## ⚠️ Read this first — a new route is added inside this access-control story

Section 2 below proposes adding `GET /api/recommendation-engine/feedback`. This is genuine
new feature surface, not a refactor of anything that already exists — it was not asked for
by S-11 or any other story. It exists solely because the ownership trust scenario has
nothing real to test against without it (explained in full in Section 2). This is flagged
here, at the top, on purpose: it is a deliberate, narrowly-scoped choice made to satisfy the
trust scenario honestly rather than fake it, and Ali should see it as a decision to review,
not stumble across it inside an otherwise-expected RBAC diff.

## Section 1 — the permission matrix

Every route was checked against three things: the exact persona in that route's own
originating story ("As a sales rep...", "As a recruiter..."), precedent already set in this
codebase (decision 009's `PII_VISIBLE_ROLES`, and an existing code comment in
`jobOpenings.ts` explicitly leaving that file open to all roles on purpose), and — critically
— real evidence from the existing test suite about which roles are already being exercised
against which routes, so this matrix doesn't invent a restriction the tests already
contradict.

| Route file | Route(s) | Roles | Confidence / rationale |
|---|---|---|---|
| `health.ts` | `GET /health` | none (public) | unchanged, ops endpoint |
| `auth.ts` | register, login | none (public) | unchanged, decision 003 |
| `admin.ts` | `POST /admin/users` | `admin` | unchanged, already enforced (decision 010) |
| `candidates.ts` | GET (list, by id) | `admin`, `sales`, `recruiter` | unchanged — decision 009 gates *fields returned*, not the route; S-06 needs any role to read |
| `candidates.ts` | POST/PUT/DELETE | `admin`, `recruiter` | unchanged, existing `PII_VISIBLE_ROLES` |
| `clients.ts` | GET (list, by id) | `admin`, `sales`, `recruiter` | unchanged, same reasoning |
| `clients.ts` | POST/PUT/DELETE | `admin`, `recruiter` | unchanged, existing `PII_VISIBLE_ROLES` |
| `jobOpenings.ts` | all 5 routes | `admin`, `sales`, `recruiter` | unchanged — existing code comment: deliberately open, S-06 needs any role to read, Ali's build note doesn't restrict who creates one |
| `hiddenDemand.ts` | analyze, list opportunities | `admin`, `sales` | **NEW.** S-04: "As a sales rep..." — high confidence |
| `opportunities.ts` | `POST /score` | `admin`, `sales` | **NEW.** Feeds the same sales-facing queue as S-04 |
| `clientMatchmaking.ts` | `POST /match` | `admin`, `sales` | **NEW.** S-06: "As a sales rep..." — high confidence |
| `salesPipeline.ts` | update, board | `admin`, `sales` | **NEW.** S-08: "As a sales rep..." — high confidence |
| `opportunityPackage.ts` | draft, release, list | `admin`, `sales`, `recruiter` | **NEW.** S-09's persona is "sales rep," but `opportunityPackage.release.test.ts` already exercises a recruiter token — treated as real evidence recruiter access was anticipated, not a stray token choice. Default inclusive. |
| `opportunityRelationships.ts` | list, decide | `admin`, `sales`, `recruiter` | **NEW.** Same situation: `opportunityRelationships.decide.trust.test.ts` already uses a recruiter token. Default inclusive. |
| `recommendationEngine.ts` | recommend, feedback | `admin`, `recruiter` | **NEW.** S-11: "As a recruiter..." — the one unambiguous single-role case in the whole matrix |
| `recommendationEngine.ts` | `GET /feedback` (new route, Section 2) | `admin`, `recruiter` | **NEW route.** Exists to make the ownership check testable |
| `analytics.ts` | `GET /analytics` | `admin`, `sales`, `recruiter` | **NEW.** "Agency manager" persona is ambiguous; aggregate-only, no PII (decision 020) — default inclusive, **lower confidence** |
| `predictiveAnalysis.ts` | `POST /forecast` | `admin`, `sales`, `recruiter` | **NEW.** Same reasoning as analytics, **lower confidence** |

Rows marked "lower confidence" (analytics, predictiveAnalysis) and the three "default
inclusive" rows (opportunityPackage, opportunityRelationships, and the two above) are the
ones most likely to need Ali's correction — named explicitly so he can scan straight to
them rather than reread the whole table.

Implementation reuses `requireRole(roles: string[])` from
`backend/src/middleware/requireRole.ts` exactly as-is (decision 010) — no fork, no second
pattern. Every "NEW" row is `requireAuth, requireRole([...])` inserted into a route that
today only has `requireAuth`.

## Section 2 — what "ownership" means here, and the new route

Four tables have an actor column today (confirmed by reading every migration):
`sales_pipeline_audit.changed_by`, `opportunity_packages.released_by` (+ its release-audit
table), `relationship_path_decisions.decided_by`, `recommendation_feedback.recruiter_id`.
Nine tables — including `clients`, `candidates`, `job_openings`, and `opportunities`
themselves — have **no** owner or actor column at all. This decision does not add one to
any of them.

### Options considered
1. Add `created_by`/`owner_id` columns to the ownerless tables via a new migration, so
   ownership can be enforced broadly.
2. Enforce ownership only where an actor column already exists.
3. Enforce ownership only where an actor column exists **and** represents genuine per-user
   exclusivity, not just "who performed this action."

### What we chose, and why
Option 3. Of the four actor columns, only one is ownership in the access-control sense —
the other three record *who acted*, on resources that are legitimately team-shared, not
assigned to a specific rep:

- `sales_pipeline_audit.changed_by`, `opportunity_packages.released_by`,
  `relationship_path_decisions.decided_by` — a client's pipeline, a draft package, a
  relationship decision are all worked by whichever sales/admin user is handling that
  opportunity, not siloed to the one person who last touched them. Enforcing ownership here
  would invent a restriction with no basis in the schema or any story text, and would
  plausibly break a real shared-pipeline workflow (a rep covering a colleague's client,
  for instance). **Deliberately not enforced — this is an explicit scope exclusion, not an
  oversight.**
- `recommendation_feedback.recruiter_id` is different: it already drives a real per-user
  filter today — `POST /recommendation-engine/feedback` always sets `recruiter_id` from the
  caller's own JWT, never from client input. This is the one place "ownership" is already
  schema-backed, not something this decision invents.

**A more honest finding, stated plainly rather than glossed over:** even
`recommendation_feedback` has no *reachable* ownership-denial scenario in the route surface
that exists today. Because `recruiter_id` is always self-set on write, a user structurally
cannot write another user's row — there's nothing to deny. And there is no existing
GET-by-id (or GET-at-all) route over this table. So the trust scenario as written — "a sales
user requests another user's resource... denied unless they own it or are admin" — cannot
be tested honestly against code that doesn't exist. Rather than write a test that doesn't
actually exercise a real code path, or silently reinterpret the trust scenario into
something less than what Ali asked for, this decision adds the smallest route that makes it
real.

### The new route
`GET /api/recommendation-engine/feedback?jobId=X` (gated `admin`, `recruiter`, per Section
1) — with no `recruiterId` query param, returns the caller's own feedback rows for that
job. A non-admin caller who explicitly passes `?recruiterId=<someone else's id>` gets 403.
An admin may pass any `recruiterId`, or omit it to see all feedback for the job. This is the
minimum addition that makes the already-existing `recruiter_id` column enforceable and
testable, without inventing ownership anywhere it doesn't already exist.

### A phrasing note on the trust scenario's own Gherkin
The story's Gherkin literally says "a sales user" is denied another user's resource. Under
this matrix, `sales` has no access to `recommendation_feedback` at all — that literal case
is trivially denied by the *role* gate, before ownership is ever evaluated. The substantive
test this decision actually implements is recruiter-vs-recruiter: same role, different
owner. Flagging this mismatch explicitly rather than silently reinterpreting Ali's Gherkin
to match what was built.

## What this rests on

That the three non-ownership actor columns genuinely represent team-shared work, not
per-rep exclusivity the business actually wants enforced — this is inferred from the
absence of any story text suggesting otherwise, not confirmed by Ali directly.

## What would make this wrong

If Ali wants broader ownership enforcement (e.g., "a sales rep should only see clients
assigned to them"), that requires new schema — an `owner_id`/`assigned_to` column on
`clients` at minimum — which is real, additive scope beyond what this decision builds, not
a tweak to it. If he wants the three excluded actor columns treated as ownership after all,
that's a straightforward addition once he confirms the underlying workflow assumption above
is wrong. If he'd rather the ownership trust scenario be satisfied without adding a new
route, an alternative is retrofitting an existing write path to accept and check a
target-user parameter — but that likely means *weakening* today's self-set-only guarantee
on `recruiter_id` to give it something to check, which trades one honest gap for a worse one.
