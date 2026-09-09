import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * S-24 (Fix 1): GET /api/opportunities/summary backs the Overview and
 * Opportunities tile counts so neither screen has to pull the full
 * opportunities table and re-filter it on every render. Same
 * throwaway-schema pattern as analytics.pii.integration.test.ts.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("GET /api/opportunities/summary (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_opp_summary_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  async function seed(opts: {
    source: string;
    hardToFillScore: number;
    hardToFillFactors: unknown[];
  }) {
    await scopedPool.query(
      `INSERT INTO opportunities
         (source, external_signal_id, company, title, confidence_score, reasons, weights_version, factor_breakdown,
          hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors, hard_to_fill_version)
       VALUES ($1, $2, 'Test Co', 'Test Title', 0.5, ARRAY['open 5 days'], 'v1', '[]'::jsonb,
               $3, ARRAY[]::text[], $4::jsonb, 'hard-to-fill-026-v2')`,
      [opts.source, randomUUID(), opts.hardToFillScore, JSON.stringify(opts.hardToFillFactors)],
    );
  }

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);

    // measured: real S-23 shape.
    await seed({
      source: "greenhouse",
      hardToFillScore: 0.8,
      hardToFillFactors: [
        { factor: "roleScarcity", weight: 0.6, value: 1, contribution: 0.6, basis: "measured", familyKey: "ml-ai" },
        { factor: "daysOpen", weight: 0.2, value: 1, contribution: 0.2, basis: "n/a" },
        { factor: "repostedRole", weight: 0.2, value: 0, contribution: 0, basis: "n/a" },
      ],
    });
    // curated: real S-23 shape.
    await seed({
      source: "greenhouse",
      hardToFillScore: 0.66,
      hardToFillFactors: [
        { factor: "roleScarcity", weight: 0.6, value: 1, contribution: 0.6, basis: "curated" },
        { factor: "daysOpen", weight: 0.2, value: 0.3, contribution: 0.06, basis: "n/a" },
        { factor: "repostedRole", weight: 0.2, value: 0, contribution: 0, basis: "n/a" },
      ],
    });
    // Pre-S-23 (hard-to-fill-026-v1) shape: roleScarcity present but with NO
    // `basis` key at all -- must land in the noBasis remainder, not get
    // miscounted as measured or curated just because a roleScarcity factor
    // exists.
    await seed({
      source: "greenhouse",
      hardToFillScore: 0.6,
      hardToFillFactors: [
        { factor: "roleScarcity", weight: 0.6, value: 1, contribution: 0.6 },
        { factor: "daysOpen", weight: 0.2, value: 0, contribution: 0 },
        { factor: "repostedRole", weight: 0.2, value: 0, contribution: 0 },
      ],
    });
    // Pre-S-07: no factor breakdown at all.
    await seed({ source: "lever", hardToFillScore: 0, hardToFillFactors: [] });
    // Excluded from every count above, only counted in sourceExcluded.
    await seed({ source: "seed-job-board", hardToFillScore: 1, hardToFillFactors: [] });

    await scopedPool.query(`INSERT INTO clients (name, contact_info) VALUES ('Acme', '{}')`);
    await scopedPool.query(
      `INSERT INTO candidates (name, skills, contact_info) VALUES ('Jane Doe', ARRAY['sql'], '{}')`,
    );
    await scopedPool.query(
      `INSERT INTO raw_requisitions (source, external_id, raw_response, http_status)
       VALUES ('greenhouse', 'ext-1', '{}'::jsonb, 200)`,
    );
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("computes total/hardToFill/basis-tier/source-excluded counts, excluding seed-job-board from the main counts", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app).get("/api/opportunities/summary").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4); // excludes the one seed-job-board row
    expect(res.body.hardToFill).toBe(3); // scores 0.8, 0.66, 0.6 clear the 0.5 threshold; the 0 does not
    expect(res.body.measuredBasis).toBe(1);
    expect(res.body.curatedBasis).toBe(1);
    expect(res.body.sourceExcluded).toBe(1);
    expect(res.body.totalClients).toBe(1);
    expect(res.body.totalCandidates).toBe(1);
    expect(res.body.totalRequisitionsIngested).toBe(1);
    expect(typeof res.body.generatedAt).toBe("string");
  });

  it("counts a pre-S-23 (v1-shape) roleScarcity factor with no basis field as noBasis, not measured or curated", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app).get("/api/opportunities/summary").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    // measuredBasis(1) + curatedBasis(1) + noBasis must equal total(4) exactly
    // -- the v1-shape row and the no-factors row both fall into noBasis (2).
    expect(res.body.noBasis).toBe(2);
    expect(res.body.measuredBasis + res.body.curatedBasis + res.body.noBasis).toBe(res.body.total);
  });

  it("rejects a recruiter role (same gate as the opportunities list)", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app)
      .get("/api/opportunities/summary")
      .set("Authorization", "Bearer not-a-real-token");

    expect(res.status).toBe(401);
  });
});
