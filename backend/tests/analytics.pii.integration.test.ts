import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-12, TBI): "analytics are aggregate-only; PII stays out of the
 * reporting layer." Registry-driven on purpose, per 06_decisions/020: this
 * does NOT hardcode a list of "known PII fields to check for" — it reads
 * pii_fields itself, the same registry S-05 built and every story since has
 * registered columns into. That means it keeps proving the aggregate-only
 * guarantee as future stories add more PII columns, without anyone having to
 * remember to update this test.
 *
 * Requires a real Postgres — the whole point is checking the actual
 * registry contents, not a fake pool's approximation of it. Same
 * throwaway-schema pattern as pii.registryCoverage.test.ts.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function toCamelCase(snakeCase: string): string {
  return snakeCase.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describeIfDb(
  "GET /api/analytics — aggregate-only, zero PII (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_analytics_pii_${randomUUID().replace(/-/g, "_")}`;
    const adminPool = new Pool({ connectionString: DATABASE_URL });
    let scopedPool: Pool;

    beforeAll(async () => {
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      scopedPool = new Pool({
        connectionString: DATABASE_URL,
        options: `-c search_path=${schemaName}`,
      });
      await runMigrations(scopedPool);

      // Real rows, including PII-bearing ones, so this test is actually
      // exercising "did it get filtered out," not vacuously passing over an
      // empty response.
      const { rows: clientRows } = await scopedPool.query(
        `INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id`,
        ["Acme Corp", { email: "contact@acme.example", phone: "555-0100" }],
      );
      const clientId = clientRows[0].id as string;

      await scopedPool.query(
        `INSERT INTO sales_pipeline_audit (client_id, changed_by, from_stage, to_stage, changed_at)
         VALUES ($1, 'user-1', NULL, 'prospecting', '2026-01-05T00:00:00Z')`,
        [clientId],
      );
      await scopedPool.query(
        `INSERT INTO sales_pipeline_audit (client_id, changed_by, from_stage, to_stage, changed_at)
         VALUES ($1, 'user-1', 'prospecting', 'closed', '2026-01-20T00:00:00Z')`,
        [clientId],
      );

      await scopedPool.query(
        `INSERT INTO opportunities
           (source, external_signal_id, company, confidence_score, reasons, weights_version, factor_breakdown)
         VALUES ('mock-job-board', 'ext-1', 'Acme Corp', 0.8, ARRAY['open 5 days'], 'v1', '[]'::jsonb)`,
      );
    });

    afterAll(async () => {
      await scopedPool.end();
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    });

    it("contains none of the registered pii_fields column names, in either snake_case or camelCase", async () => {
      const { rows: registered } = await scopedPool.query<{ column_name: string }>(
        "SELECT DISTINCT column_name FROM pii_fields",
      );
      expect(registered.length).toBeGreaterThan(0); // sanity: the registry isn't empty

      const forbiddenKeys = new Set<string>();
      for (const row of registered) {
        forbiddenKeys.add(row.column_name);
        forbiddenKeys.add(toCamelCase(row.column_name));
      }

      const app = createApp(scopedPool, noopProvider);
      const res = await request(app).get("/api/analytics").set("Authorization", salesAuthHeader());

      expect(res.status).toBe(200);
      // Sanity check the response actually has real content — a trust test
      // over an empty payload proves nothing.
      expect(res.body.placementsPerMonth.length).toBeGreaterThan(0);

      const responseKeys = collectKeys(res.body);
      const leaked = [...responseKeys].filter((key) => forbiddenKeys.has(key));
      expect(leaked).toEqual([]);
    });
  },
);
