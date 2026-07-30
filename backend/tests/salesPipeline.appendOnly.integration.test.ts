import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-08, TBI rule 3): "the audit log is append-only by database
 * constraint." A fake in-memory pool cannot prove a real Postgres trigger
 * actually rejects UPDATE/DELETE, so this needs a genuine database — gated
 * purely on DATABASE_URL, same as migrate.test.ts, not an extra opt-in flag
 * like the timing tests: this is a correctness guarantee, not a wall-clock
 * number, so it should run in CI/docker-compose whenever a real DB is
 * reachable, and skip cleanly on a bare laptop `npm test` with no DB running.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "sales_pipeline_audit append-only enforcement (integration, requires DATABASE_URL)",
  () => {
    // A throwaway schema, not the shared database — same reasoning as
    // migrate.test.ts: this test both writes real rows and attempts to
    // mutate them, so it must run somewhere no other process's data or
    // migration state can make the result a coin flip.
    const schemaName = `test_pipeline_audit_${randomUUID().replace(/-/g, "_")}`;
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
        "INSERT INTO clients (name) VALUES ($1) RETURNING id",
        ["Acme Corp"],
      );
      const clientId = clientRows[0].id as string;

      const app = createApp(scopedPool, noopProvider);
      const updateRes = await request(app)
        .post("/api/sales-pipeline/update")
        .set("Authorization", salesAuthHeader())
        .send({ clientId, toStage: "prospecting" });
      expect(updateRes.status).toBe(200);

      const before = await scopedPool.query(
        "SELECT * FROM sales_pipeline_audit WHERE client_id = $1",
        [clientId],
      );
      expect(before.rows).toHaveLength(1);
      const auditId = before.rows[0].id as string;

      await expect(
        scopedPool.query("UPDATE sales_pipeline_audit SET to_stage = 'closed' WHERE id = $1", [
          auditId,
        ]),
      ).rejects.toThrow(/append-only/);

      await expect(
        scopedPool.query("DELETE FROM sales_pipeline_audit WHERE id = $1", [auditId]),
      ).rejects.toThrow(/append-only/);

      const after = await scopedPool.query(
        "SELECT * FROM sales_pipeline_audit WHERE client_id = $1",
        [clientId],
      );
      expect(after.rows).toEqual(before.rows);
    });
  },
);
