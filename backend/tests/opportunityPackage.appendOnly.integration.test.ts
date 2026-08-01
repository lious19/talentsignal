import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-09, TBI rule 3, mirroring 06_decisions/013): the release record —
 * who released a package and when — must be append-only by DATABASE
 * CONSTRAINT, not application convention. Same reasoning and same technique
 * as salesPipeline.appendOnly.integration.test.ts: a fake in-memory pool
 * can't prove a real Postgres trigger rejects UPDATE/DELETE, so this needs a
 * genuine database, gated purely on DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "opportunity_package_release_audit append-only enforcement (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_package_audit_${randomUUID().replace(/-/g, "_")}`;
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

    it("rejects UPDATE and DELETE against a release-audit row, leaving it byte-for-byte unchanged", async () => {
      const { rows: opportunityRows } = await scopedPool.query(
        `INSERT INTO opportunities (source, external_signal_id, company, confidence_score, reasons, weights_version, factor_breakdown)
         VALUES ('test', 'ext-1', 'Acme Corp', 0.5, ARRAY['open 5 days'], 'v1', '[]'::jsonb)
         RETURNING id`,
      );
      const { rows: jobRows } = await scopedPool.query(
        `INSERT INTO clients (name) VALUES ('Acme Corp') RETURNING id`,
      );
      const clientId = jobRows[0].id as string;
      const { rows: jobOpeningRows } = await scopedPool.query(
        `INSERT INTO job_openings (client_id, title, requirements) VALUES ($1, 'Engineer', ARRAY[]::text[]) RETURNING id`,
        [clientId],
      );
      const opportunityId = opportunityRows[0].id as string;
      const jobOpeningId = jobOpeningRows[0].id as string;

      const app = createApp(scopedPool, noopProvider);
      const draftRes = await request(app)
        .post("/api/opportunity-package/draft")
        .set("Authorization", salesAuthHeader())
        .send({ opportunityId, jobOpeningId });
      expect(draftRes.status).toBe(201);

      const releaseRes = await request(app)
        .post(`/api/opportunity-package/${draftRes.body.package.id}/release`)
        .set("Authorization", salesAuthHeader());
      expect(releaseRes.status).toBe(200);

      const before = await scopedPool.query(
        "SELECT * FROM opportunity_package_release_audit WHERE package_id = $1",
        [draftRes.body.package.id],
      );
      expect(before.rows).toHaveLength(1);
      const auditId = before.rows[0].id as string;

      await expect(
        scopedPool.query(
          "UPDATE opportunity_package_release_audit SET released_by = 'someone-else' WHERE id = $1",
          [auditId],
        ),
      ).rejects.toThrow(/append-only/);

      await expect(
        scopedPool.query("DELETE FROM opportunity_package_release_audit WHERE id = $1", [auditId]),
      ).rejects.toThrow(/append-only/);

      const after = await scopedPool.query(
        "SELECT * FROM opportunity_package_release_audit WHERE package_id = $1",
        [draftRes.body.package.id],
      );
      expect(after.rows).toEqual(before.rows);
    });
  },
);
