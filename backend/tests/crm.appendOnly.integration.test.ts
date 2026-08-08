import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-16, same discipline as S-08/S-15): the guarded-write audit trail
 * cannot be rewritten. A fake in-memory pool cannot prove a real Postgres
 * trigger actually rejects UPDATE/DELETE, so this needs a genuine database
 * — gated purely on DATABASE_URL, same as the S-08/S-15 append-only tests.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "crm_write_audit append-only enforcement (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_crm_audit_${randomUUID().replace(/-/g, "_")}`;
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
      const { rows: clientRows } = await scopedPool.query(
        "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
        ["Acme Corp", { email: "ops@acme.example" }],
      );
      const clientId = clientRows[0].id as string;

      const app = createApp(scopedPool, noopProvider);
      const res = await request(app)
        .post("/api/crm/write")
        .set("Authorization", salesAuthHeader())
        .send({
          idempotencyKey: randomUUID(),
          clientId,
          name: "Acme Corporation",
          contactInfo: { email: "ops@acme.example" },
        });
      expect(res.status).toBe(201);

      const before = await scopedPool.query(
        "SELECT * FROM crm_write_audit WHERE write_id = $1",
        [res.body.write.id],
      );
      expect(before.rows).toHaveLength(1);
      const auditId = before.rows[0].id as string;

      await expect(
        scopedPool.query("UPDATE crm_write_audit SET step = 'rolled_back' WHERE id = $1", [
          auditId,
        ]),
      ).rejects.toThrow(/append-only/);

      await expect(
        scopedPool.query("DELETE FROM crm_write_audit WHERE id = $1", [auditId]),
      ).rejects.toThrow(/append-only/);

      const after = await scopedPool.query(
        "SELECT * FROM crm_write_audit WHERE write_id = $1",
        [res.body.write.id],
      );
      expect(after.rows).toEqual(before.rows);
    });
  },
);
