import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-15): "the audit log cannot be rewritten" — the SAME trust
 * scenario S-08 already proves for sales_pipeline_audit, reapplied to
 * privacy_audit_log. A fake in-memory pool cannot prove a real Postgres
 * trigger actually rejects UPDATE/DELETE, so this needs a genuine database
 * — gated purely on DATABASE_URL, same as
 * salesPipeline.appendOnly.integration.test.ts.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "privacy_audit_log append-only enforcement (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_privacy_audit_${randomUUID().replace(/-/g, "_")}`;
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

    it("rejects UPDATE and DELETE against an audit row, leaving it byte-for-byte unchanged", async () => {
      const { rows: candidateRows } = await scopedPool.query(
        "INSERT INTO candidates (name, contact_info) VALUES ($1, $2) RETURNING id",
        ["Jamie Rivera", { email: "jamie@example.com" }],
      );
      const candidateId = candidateRows[0].id as string;

      const app = createApp(scopedPool, noopProvider);
      const res = await request(app)
        .post("/api/privacy/request")
        .set("Authorization", recruiterAuthHeader())
        .send({ subjectType: "candidate", subjectId: candidateId, requestType: "access" });
      expect(res.status).toBe(201);

      const before = await scopedPool.query(
        "SELECT * FROM privacy_audit_log WHERE request_id = $1 ORDER BY recorded_at",
        [res.body.request.id],
      );
      expect(before.rows.length).toBeGreaterThan(0);
      const auditId = before.rows[0].id as string;

      await expect(
        scopedPool.query("UPDATE privacy_audit_log SET step = 'queued' WHERE id = $1", [
          auditId,
        ]),
      ).rejects.toThrow(/append-only/);

      await expect(
        scopedPool.query("DELETE FROM privacy_audit_log WHERE id = $1", [auditId]),
      ).rejects.toThrow(/append-only/);

      const after = await scopedPool.query(
        "SELECT * FROM privacy_audit_log WHERE request_id = $1 ORDER BY recorded_at",
        [res.body.request.id],
      );
      expect(after.rows).toEqual(before.rows);
    });
  },
);
