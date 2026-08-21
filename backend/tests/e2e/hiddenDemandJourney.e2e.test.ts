import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../../src/app";
import { runMigrations } from "../../src/db/migrate";
import { seedDemo } from "../../src/db/seedDemo";
import { SeedJobBoardProvider } from "../../src/adapters/seedJobBoardProvider";

/**
 * S-19 E2E journey #1 (Gherkin: "login -> hidden-demand analyze ->
 * opportunities -> hard-to-fill targeting"). Unlike today's
 * *.integration.test.ts files, which each drive ONE router in isolation
 * against hand-built fixtures, this proves the SEAM between routers: a row
 * POST /hidden-demand/analyze writes is the exact row a later GET
 * /hidden-demand/opportunities and GET /hard-to-fill/targeting read back
 * through real Postgres, in one continuous flow, starting from a real
 * register+login (not a signed-JWT shortcut). See 06_decisions/029.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "E2E: register -> login -> analyze -> opportunities -> targeting (requires DATABASE_URL)",
  () => {
    const schemaName = `test_e2e_hidden_demand_${randomUUID().replace(/-/g, "_")}`;
    const adminPool = new Pool({ connectionString: DATABASE_URL });
    let scopedPool: Pool;

    beforeAll(async () => {
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      scopedPool = new Pool({
        connectionString: DATABASE_URL,
        options: `-c search_path=${schemaName}`,
      });
      await runMigrations(scopedPool);
      // A seeded baseline, same dataset the live demo uses — the journey's
      // own live analyze() call below adds a few more rows on top of it,
      // proving a live write integrates correctly alongside pre-seeded data.
      await seedDemo(scopedPool);
    });

    afterAll(async () => {
      await scopedPool.end();
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    });

    it(
      "a sales user registers, logs in for real, analyzes signals, and sees them through to targeting",
      async () => {
        const app = createApp(scopedPool, new SeedJobBoardProvider(6));
        const email = `e2e-${randomUUID()}@example.com`;
        const password = "correct-horse-battery";

        const registerRes = await request(app)
          .post("/api/auth/register")
          .send({ email, password });
        expect(registerRes.status).toBe(201);
        expect(registerRes.body.role).toBe("sales");

        // Real login — one call for this whole file, well under the
        // 10/15min limiter (a fresh createApp() gives this file its own
        // rate-limiter instance, per authRouter's design).
        const loginRes = await request(app).post("/api/auth/login").send({ email, password });
        expect(loginRes.status).toBe(200);
        const token = `Bearer ${loginRes.body.token as string}`;

        const analyzeRes = await request(app)
          .post("/api/hidden-demand/analyze")
          .set("Authorization", token);
        expect(analyzeRes.status).toBe(201);
        expect(analyzeRes.body.opportunities).toHaveLength(6);
        // SeedJobBoardProvider(6): rows 0 and 3 (every 3rd) cycle a
        // roleKeywords title and can clear the hard-to-fill threshold.
        const analyzedHardToFill = analyzeRes.body.opportunities.filter(
          (o: { hardToFill: boolean }) => o.hardToFill,
        );
        expect(analyzedHardToFill.length).toBeGreaterThan(0);
        const analyzedIds = new Set(analyzeRes.body.opportunities.map((o: { id: string }) => o.id));

        const opportunitiesRes = await request(app)
          .get("/api/hidden-demand/opportunities?includeSeedData=true")
          .set("Authorization", token);
        expect(opportunitiesRes.status).toBe(200);
        // Every id analyze() just wrote is readable back through a
        // different endpoint, through real Postgres — not just the
        // insert's own RETURNING.
        const listedIds = new Set(
          opportunitiesRes.body.opportunities.map((o: { id: string }) => o.id),
        );
        for (const id of analyzedIds) {
          expect(listedIds.has(id)).toBe(true);
        }

        const targetingRes = await request(app)
          .get("/api/hard-to-fill/targeting?includeSeedData=true")
          .set("Authorization", token);
        expect(targetingRes.status).toBe(200);
        expect(targetingRes.body.suggestion).toBe(true);
        expect(targetingRes.body.targets.length).toBeGreaterThan(0);
        const targetOpportunityIds = new Set(
          targetingRes.body.targets.map((t: { opportunityId: string }) => t.opportunityId),
        );
        // At least one hard-to-fill target traces back to a row this very
        // journey's analyze() call wrote — proving the pipeline's write is
        // visible to a downstream read, not just to the seed baseline.
        const overlap = [...analyzedIds].some((id) => targetOpportunityIds.has(id));
        expect(overlap).toBe(true);
      },
      30_000,
    );
  },
);
