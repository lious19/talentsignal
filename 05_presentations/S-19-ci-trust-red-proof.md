# S-19 — CI trust-gate red proof

**Date:** 2026-08-21
**What this proves:** CI's gate (`npm test`, the exact command `.github/workflows/ci.yml`'s
`backend` job runs) goes red when the human-release guardrail (REQ-020) is violated, not just
when a happy path breaks.

No git remote is configured for this repo yet (`git remote -v` returns empty — tracked as the
REPO to-do ahead of S-20), so a live GitHub Actions red run isn't achievable today. This is a
direct local reproduction of CI's exact command against a real migrated Postgres, which is the
strongest proof available without a remote.

## The break

A one-line change to `backend/src/routes/opportunityPackage.ts`'s draft handler — the exact kind
of real regression the trust scenario exists to catch (an AI-drafted package accidentally
shipping as already-released instead of waiting for a human):

```diff
        const { rows } = await pool.query(
          `INSERT INTO opportunity_packages
             (opportunity_id, job_opening_id, candidate_ids, content, ai_generated, status)
-          VALUES ($1, $2, $3, $4, true, 'draft')
+          VALUES ($1, $2, $3, $4, true, 'released')
           RETURNING *`,
          [opportunityId, jobOpeningId, candidateIds, JSON.stringify(content)],
        );
```

## The command

```
DATABASE_URL="postgres://talentsignal:talentsignal@localhost:5433/talentsignal" \
JWT_SECRET="<32+ char value>" \
npm test
```

— identical to `.github/workflows/ci.yml`'s `backend` job step, run against the real
`docker compose` Postgres container (`postgres:16-alpine`, migrated fresh per test file via each
test's own scoped-schema `beforeAll`).

## Result: red

```
Test Files  2 failed | 67 passed | 4 skipped (73)
     Tests  2 failed | 293 passed | 4 skipped (299)
```

**`tests/e2e/matchmakingToReleaseJourney.e2e.test.ts`**
> E2E: clients/candidates -> matchmaking -> recommend+feedback -> package draft -> release
> (requires DATABASE_URL) > a package drafted from live-created data stays draft until release,
> then rejects a second release
> → expected 'released' to be 'draft' // Object.is equality

This is the E2E journey's own TRUST assertion (step 10 of the plan: `GET /opportunity-packages`
must show the freshly drafted package still `"draft"` — nothing auto-released it). It caught the
break immediately, at the exact point the guarantee is supposed to hold.

**`tests/opportunityPackage.appendOnly.integration.test.ts`**
> opportunity_package_release_audit append-only enforcement (integration, requires DATABASE_URL)
> > rejects UPDATE and DELETE against a release-audit row, leaving it byte-for-byte unchanged
> → expected 409 to be 200 // Object.is equality

This test drafts, then calls `/release` once expecting `200`. With the draft handler already
inserting `status: 'released'`, the real `/release` route's `WHERE status = 'draft'` guard no
longer matches anything, so the call 409s as an "already released" — a second, independent
symptom of the same regression, caught by a different test file for a different reason (its real
purpose — proving the audit table itself is append-only — never even got to run because the
precondition it depends on, a package that starts in `draft`, no longer existed).

Two other files that also assert on package status (`opportunityPackage.trust.test.ts`, the
`hiddenDemandJourney`/other flows that don't exercise draft→release) did not fail, since they
don't happen to exercise this handler under `DATABASE_URL`-gated conditions — consistent with the
break being narrowly in the draft-insert path, not a broader outage.

## Revert and re-confirm green

Reverted the one line back to `'draft'`. `git diff --stat` on the file: no changes (byte-identical
to the pre-break version — nothing else was left modified). Re-ran the identical command:

```
Test Files  69 passed | 4 skipped (73)
     Tests  295 passed | 4 skipped (299)
```

Green again, no lingering state (each test's scoped-schema `afterAll` drops its own schema
regardless of pass/fail).

## What this does and doesn't prove

**Proves:** the gate is load-bearing. A real, minimal regression in the human-release code path
turns `npm test` non-zero, immediately and specifically (two failures, both tracing to the actual
break — not a flood of unrelated failures that would bury the signal).

**Doesn't prove (yet):** that pushing this same break to GitHub actually blocks a PR — that needs
a live Actions run, which needs the repo pushed to GitHub first (the REPO to-do, ahead of S-20).
Once a remote exists, the natural stronger follow-up is a throwaway branch with this same one-line
diff and a link to the resulting red Actions run.
