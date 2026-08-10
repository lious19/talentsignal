import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST: segmentation (S-17) is the first analytics-family route to read
 * clients ROWS at all — analytics.ts/predictiveAnalysis.ts only ever read
 * sales_pipeline_audit/opportunities. Registry-driven on purpose
 * (06_decisions/020's reasoning, reused): reads pii_fields itself rather
 * than hardcoding "known PII fields to check for."
 *
 * One deliberate, documented adaptation of the analytics.pii.integration.test.ts
 * pattern: that test's forbidden-key check is COLUMN-NAME-only, not
 * table+column-aware. pii_fields registers candidates.name (anonymize) — a
 * real PII column — but clients.name is a REVIEWED non-PII exception
 * (004_clients_candidates_jobs.sql's own comment: "a client *company* name,
 * not personal data"; pii.registryCoverage.test.ts's REVIEWED_NOT_PII
 * already carries the identical exception for the same reason). Segmentation
 * legitimately returns a client's name, so a flat "name" forbidden-key match
 * would be a false positive here, not a real leak. The stronger, more
 * precise check below — asserting the actual seeded contact_info VALUE never
 * appears anywhere in the response body — is what actually proves the trust
 * property; the key-name check still runs for every other registered column.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const REVIEWED_NOT_PII_KEYS = new Set(["name"]);

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
  "GET /api/analytics/anomalies — segmentation reads clients but leaks no registered PII (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_anomaly_pii_${randomUUID().replace(/-/g, "_")}`;
    const adminPool = new Pool({ connectionString: DATABASE_URL });
    let scopedPool: Pool;
    const seededEmail = "contact@acme.example";

    beforeAll(async () => {
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      scopedPool = new Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schemaName}` });
      await runMigrations(scopedPool);

      const { rows: clientRows } = await scopedPool.query(
        `INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id`,
        ["Acme Corp", { email: seededEmail, phone: "555-0100" }],
      );
      const clientId = clientRows[0].id as string;

      await scopedPool.query(`INSERT INTO job_openings (client_id, title) VALUES ($1, 'Recruiter')`, [clientId]);

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
    });

    afterAll(async () => {
      await scopedPool.end();
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    });

    it("contains none of the registered pii_fields column names or values, in either snake_case or camelCase", async () => {
      const { rows: registered } = await scopedPool.query<{ column_name: string }>(
        "SELECT DISTINCT column_name FROM pii_fields",
      );
      expect(registered.length).toBeGreaterThan(0);

      const forbiddenKeys = new Set<string>();
      for (const row of registered) {
        if (REVIEWED_NOT_PII_KEYS.has(row.column_name)) continue;
        forbiddenKeys.add(row.column_name);
        forbiddenKeys.add(toCamelCase(row.column_name));
      }

      const app = createApp(scopedPool, noopProvider);
      const res = await request(app).get("/api/analytics/anomalies").set("Authorization", salesAuthHeader());

      expect(res.status).toBe(200);
      // Sanity: segmentation actually returned the seeded client somewhere.
      expect(res.body.segments.groups.length).toBeGreaterThan(0);

      const responseKeys = collectKeys(res.body);
      const leaked = [...responseKeys].filter((key) => forbiddenKeys.has(key));
      expect(leaked).toEqual([]);

      // The precise check the key-name heuristic can't express: the actual
      // seeded contact_info value must never appear, under ANY key name.
      expect(JSON.stringify(res.body)).not.toContain(seededEmail);
      expect(JSON.stringify(res.body)).not.toContain("555-0100");
    });
  },
);
