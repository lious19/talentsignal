import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-17, same discipline as S-08/S-15/S-16): the anomaly-decision
 * audit trail cannot be rewritten. A fake in-memory pool cannot prove a real
 * Postgres trigger actually rejects UPDATE/DELETE, so this needs a genuine
 * database — gated purely on DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const MONTHS = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05",
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10",
];
const SPIKE_MONTH = "2025-10";
const COUNTS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 15];

describeIfDb("anomaly_audit append-only enforcement (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_anomaly_audit_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schemaName}` });
    await runMigrations(scopedPool);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("rejects UPDATE and DELETE against an anomaly_audit row, leaving it byte-for-byte unchanged", async () => {
    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Spike Co", {}],
    );
    const clientId = clientRows[0].id as string;

    for (let i = 0; i < MONTHS.length; i++) {
      for (let day = 1; day <= COUNTS[i]; day++) {
        await scopedPool.query(
          `INSERT INTO sales_pipeline_audit (client_id, changed_by, from_stage, to_stage, changed_at)
           VALUES ($1, 'seed', 'prospecting', 'closed', $2)`,
          [clientId, `${MONTHS[i]}-${String(day).padStart(2, "0")}T00:00:00Z`],
        );
      }
    }

    const app = createApp(scopedPool, noopProvider);
    const decide = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", salesAuthHeader())
      .send({ month: SPIKE_MONTH, decision: "confirmed" });
    expect(decide.status).toBe(200);

    const before = await scopedPool.query("SELECT * FROM anomaly_audit WHERE month = $1", [SPIKE_MONTH]);
    expect(before.rows).toHaveLength(1);
    const auditId = before.rows[0].id as string;

    await expect(
      scopedPool.query("UPDATE anomaly_audit SET step = 'suppressed' WHERE id = $1", [auditId]),
    ).rejects.toThrow(/append-only/);

    await expect(
      scopedPool.query("DELETE FROM anomaly_audit WHERE id = $1", [auditId]),
    ).rejects.toThrow(/append-only/);

    const after = await scopedPool.query("SELECT * FROM anomaly_audit WHERE month = $1", [SPIKE_MONTH]);
    expect(after.rows).toEqual(before.rows);
  });
});
