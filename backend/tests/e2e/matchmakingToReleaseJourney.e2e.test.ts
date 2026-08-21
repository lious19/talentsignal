import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../../src/app";
import { runMigrations } from "../../src/db/migrate";
import { SeedJobBoardProvider } from "../../src/adapters/seedJobBoardProvider";
import { adminAuthHeader } from "../helpers/authHeader";

/**
 * S-19 E2E journey #2 (Gherkin: "client-matchmaking / recommendation-engine
 * / package draft+release"). Proves the full human-release trust chain
 * (REQ-020) through real Postgres: a package drafted from live-created
 * client/job/candidate data stays "draft" until an explicit release call,
 * that release is recorded in the append-only audit table, and a second
 * release attempt is rejected — none of which today's single-router
 * integration tests chain together end-to-end. See 06_decisions/029.
 *
 * Uses adminAuthHeader() throughout, not a real second login: /clients and
 * /candidates writes need PII_VISIBLE_ROLES (["admin","recruiter"]),
 * /client-matchmaking/match needs ["admin","sales"], and
 * /recommendation-engine/* needs ["admin","recruiter"] — admin is the only
 * role that clears every gate this journey touches, and self-registration
 * can only ever produce "sales" (decision 003), so a second real login
 * couldn't reach recruiter/admin without directly inserting a user row.
 * Journey A already proves a real register+login round trip; this one
 * focuses on the release trust chain instead of repeating that proof.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "E2E: clients/candidates -> matchmaking -> recommend+feedback -> package draft -> release (requires DATABASE_URL)",
  () => {
    const schemaName = `test_e2e_matchmaking_release_${randomUUID().replace(/-/g, "_")}`;
    const adminPool = new Pool({ connectionString: DATABASE_URL });
    let scopedPool: Pool;

    beforeAll(async () => {
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      scopedPool = new Pool({
        connectionString: DATABASE_URL,
        options: `-c search_path=${schemaName}`,
      });
      await runMigrations(scopedPool);
    });

    afterAll(async () => {
      await scopedPool.end();
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    });

    it(
      "a package drafted from live-created data stays draft until release, then rejects a second release",
      async () => {
        const app = createApp(scopedPool, new SeedJobBoardProvider(3));
        const token = adminAuthHeader();

        const clientRes = await request(app)
          .post("/api/clients")
          .set("Authorization", token)
          .send({ name: "E2E Client Co" });
        expect(clientRes.status).toBe(201);
        const clientId = clientRes.body.id;

        const jobRes = await request(app)
          .post("/api/job-openings")
          .set("Authorization", token)
          .send({
            clientId,
            title: "E2E Data Scientist",
            requirements: ["python", "sql", "machine learning"],
          });
        expect(jobRes.status).toBe(201);
        const jobId = jobRes.body.id;

        const candidateSpecs = [
          { name: "E2E Full Overlap", skills: ["python", "sql", "machine learning"], experience: 4 },
          { name: "E2E Partial Overlap", skills: ["python"], experience: 1 },
          { name: "E2E No Overlap", skills: ["cobol"], experience: 10 },
        ];
        const candidateIds: string[] = [];
        for (const spec of candidateSpecs) {
          const res = await request(app).post("/api/candidates").set("Authorization", token).send(spec);
          expect(res.status).toBe(201);
          candidateIds.push(res.body.id);
        }

        const matchRes = await request(app)
          .post("/api/client-matchmaking/match")
          .set("Authorization", token)
          .send({ jobId });
        expect(matchRes.status).toBe(200);
        expect(matchRes.body.suggestion).toBe(true);
        const matchedIds = matchRes.body.candidates.map((c: { id: string }) => c.id);
        expect(matchedIds).toEqual(expect.arrayContaining(candidateIds));
        // Ranked descending by fit — the full-overlap candidate leads.
        expect(matchRes.body.candidates[0].id).toBe(candidateIds[0]);

        const recommendRes = await request(app)
          .post("/api/recommendation-engine/recommend")
          .set("Authorization", token)
          .send({ jobId });
        expect(recommendRes.status).toBe(200);
        const fullOverlap = recommendRes.body.candidates.find(
          (c: { id: string }) => c.id === candidateIds[0],
        );
        expect(fullOverlap.feedback).toBe("none");

        const feedbackRes = await request(app)
          .post("/api/recommendation-engine/feedback")
          .set("Authorization", token)
          .send({ jobId, candidateId: candidateIds[0], feedback: "good" });
        expect(feedbackRes.status).toBe(200);

        // Recommend again — the SAME recruiter's feedback persists across
        // calls, through real Postgres, not just in the response that wrote it.
        const recommendAgainRes = await request(app)
          .post("/api/recommendation-engine/recommend")
          .set("Authorization", token)
          .send({ jobId });
        const fullOverlapAgain = recommendAgainRes.body.candidates.find(
          (c: { id: string }) => c.id === candidateIds[0],
        );
        expect(fullOverlapAgain.feedback).toBe("good");

        const analyzeRes = await request(app)
          .post("/api/hidden-demand/analyze")
          .set("Authorization", token);
        expect(analyzeRes.status).toBe(201);
        const opportunityId = analyzeRes.body.opportunities[0].id;

        const draftRes = await request(app)
          .post("/api/opportunity-package/draft")
          .set("Authorization", token)
          .send({ opportunityId, jobOpeningId: jobId });
        expect(draftRes.status).toBe(201);
        expect(draftRes.body.package.status).toBe("draft");
        expect(draftRes.body.package.aiGenerated).toBe(true);
        expect(draftRes.body.package.releasedBy).toBeNull();
        const packageId = draftRes.body.package.id;

        // TRUST: nothing auto-released the draft between drafting it and
        // checking the list — "AI drafts, a human releases" holds through a
        // real read, not just the draft response's own status field.
        const listBeforeRelease = await request(app)
          .get("/api/opportunity-packages")
          .set("Authorization", token);
        const listedDraft = listBeforeRelease.body.packages.find(
          (p: { id: string }) => p.id === packageId,
        );
        expect(listedDraft.status).toBe("draft");
        expect(listedDraft.releasedBy).toBeNull();

        const releaseRes = await request(app)
          .post(`/api/opportunity-package/${packageId}/release`)
          .set("Authorization", token);
        expect(releaseRes.status).toBe(200);
        expect(releaseRes.body.package.status).toBe("released");
        expect(releaseRes.body.package.releasedBy).toBe("user-3"); // adminAuthHeader's default sub
        expect(releaseRes.body.package.releasedAt).not.toBeNull();

        // TRUST, proven through real Postgres, not a fake pool: the release
        // is recorded in the append-only audit table.
        const auditRows = await scopedPool.query(
          "SELECT released_by, package_id FROM opportunity_package_release_audit WHERE package_id = $1",
          [packageId],
        );
        expect(auditRows.rows).toHaveLength(1);
        expect(auditRows.rows[0].released_by).toBe("user-3");

        // Idempotency of the human-release gate, proven live: a second
        // release is rejected and the original release fields are unchanged.
        const secondReleaseRes = await request(app)
          .post(`/api/opportunity-package/${packageId}/release`)
          .set("Authorization", token);
        expect(secondReleaseRes.status).toBe(409);
        expect(secondReleaseRes.body.package.releasedAt).toBe(releaseRes.body.package.releasedAt);
      },
      30_000,
    );
  },
);
