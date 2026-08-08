import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * Proves the ON CONFLICT DO NOTHING claim is actually race-safe, not just
 * correct in the easy sequential case a fake in-memory pool (single-
 * threaded) could fake its way past. Two genuinely concurrent requests with
 * the SAME idempotency key must resolve to exactly one 'applied' write and
 * one 'deduped' event — never two 'applied' rows, which would mean the
 * client got written twice.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "crm write concurrent dedupe (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_crm_race_${randomUUID().replace(/-/g, "_")}`;
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

    it("two concurrent writes with the same key produce exactly one applied effect", async () => {
      const { rows: clientRows } = await scopedPool.query(
        "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
        ["Epsilon Group", { email: "eps@example.com" }],
      );
      const clientId = clientRows[0].id as string;
      const idempotencyKey = randomUUID();
      const app = createApp(scopedPool, noopProvider);

      const body = {
        idempotencyKey,
        clientId,
        name: "Epsilon Group Ltd",
        contactInfo: { email: "eps@example.com" },
      };

      const [resA, resB] = await Promise.all([
        request(app).post("/api/crm/write").set("Authorization", salesAuthHeader()).send(body),
        request(app).post("/api/crm/write").set("Authorization", salesAuthHeader()).send(body),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 201]);

      const writeRows = await scopedPool.query(
        "SELECT * FROM crm_writes WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(writeRows.rows).toHaveLength(1);

      const auditRows = await scopedPool.query(
        "SELECT step FROM crm_write_audit WHERE write_id = $1",
        [writeRows.rows[0].id],
      );
      const steps = auditRows.rows.map((row: { step: string }) => row.step).sort();
      expect(steps).toEqual(["applied", "deduped"]);

      const clientState = await scopedPool.query(
        "SELECT name, contact_info FROM clients WHERE id = $1",
        [clientId],
      );
      expect(clientState.rows[0].name).toBe("Epsilon Group Ltd");
    });
  },
);
