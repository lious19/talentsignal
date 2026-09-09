import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * S-24 (Fix 3): "How this was scored" needs two things that existed in the
 * schema but never reached an API response before this story:
 * opportunities.family_key (migration 018) and a raw_requisitions payload
 * joined by (source, external_id). Real Postgres required for the
 * unnest()-based join and DISTINCT ON, so this self-skips without
 * DATABASE_URL, same convention as every other *.integration.test.ts here.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("POST /api/opportunities/score — rawPayload + familyKey (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_opp_rawpayload_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;
  let withRawPayloadId: string;
  let withoutRawPayloadId: string;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);

    const externalId = `ext-${randomUUID()}`;
    const { rows } = await scopedPool.query(
      `INSERT INTO opportunities
         (source, external_signal_id, company, title, confidence_score, reasons, weights_version, factor_breakdown,
          hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors, hard_to_fill_version, family_key)
       VALUES ('greenhouse', $1, 'Test Co', 'Senior ML Engineer', 0.7, ARRAY['open 90 days'], 'v1', '[]'::jsonb,
               0.8, ARRAY['role scarcity: measured (family ''ml-ai'', median 69d vs global 33d)'], '[]'::jsonb,
               'hard-to-fill-026-v2', 'ml-ai')
       RETURNING id`,
      [externalId],
    );
    withRawPayloadId = rows[0].id as string;

    // Older fetch, then the real one -- DISTINCT ON ... ORDER BY fetched_at
    // DESC must pick the latest, not just any matching row.
    await scopedPool.query(
      `INSERT INTO raw_requisitions (source, external_id, raw_response, http_status, fetched_at)
       VALUES ('greenhouse', $1, '{"title": "stale copy"}'::jsonb, 200, now() - interval '1 day')`,
      [externalId],
    );
    await scopedPool.query(
      `INSERT INTO raw_requisitions (source, external_id, raw_response, http_status, fetched_at)
       VALUES ('greenhouse', $1, '{"title": "Senior ML Engineer", "id": "real-payload"}'::jsonb, 200, now())`,
      [externalId],
    );

    const { rows: noPayloadRows } = await scopedPool.query(
      `INSERT INTO opportunities
         (source, external_signal_id, company, title, confidence_score, reasons, weights_version, factor_breakdown,
          hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors, hard_to_fill_version)
       VALUES ('lever', $1, 'Other Co', 'Support Engineer', 0.4, ARRAY['open 10 days'], 'v1', '[]'::jsonb,
               0, ARRAY[]::text[], '[]'::jsonb, 'hard-to-fill-026-v2')
       RETURNING id`,
      [`ext-${randomUUID()}`],
    );
    withoutRawPayloadId = noPayloadRows[0].id as string;
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("returns the latest raw_requisitions payload and the real family_key for a diffed opportunity", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityIds: [withRawPayloadId] });

    expect(res.status).toBe(200);
    const opportunity = res.body.opportunities[0];
    expect(opportunity.familyKey).toBe("ml-ai");
    expect(opportunity.rawPayload).toEqual({ title: "Senior ML Engineer", id: "real-payload" });
  });

  it("returns null rawPayload when no raw_requisitions row exists for that (source, external_id) yet", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityIds: [withoutRawPayloadId] });

    expect(res.status).toBe(200);
    expect(res.body.opportunities[0].rawPayload).toBeNull();
    expect(res.body.opportunities[0].familyKey).toBeNull();
  });
});
