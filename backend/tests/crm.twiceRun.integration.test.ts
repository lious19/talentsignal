import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, salesAuthHeader } from "./helpers/authHeader";

/**
 * S-16 acceptance scenario #1, named for Ali's own phrase ("write the
 * twice-run test"): the same write, submitted twice with the same
 * idempotency key, has exactly one effect — the second call is deduped and
 * returns the stored result without re-applying. DB-gated: this asserts
 * against the real UNIQUE constraint on crm_writes.idempotency_key, which a
 * fake pool can't enforce.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("crm write — twice-run idempotency (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_crm_twicerun_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);
    app = createApp(scopedPool, noopProvider);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("the same write submitted twice with the same key has exactly one effect", async () => {
    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Beta Inc", { email: "old@beta.example" }],
    );
    const clientId = clientRows[0].id as string;
    const idempotencyKey = randomUUID();
    const body = {
      idempotencyKey,
      clientId,
      name: "Beta Incorporated",
      contactInfo: { email: "new@beta.example" },
    };

    const first = await request(app)
      .post("/api/crm/write")
      .set("Authorization", salesAuthHeader())
      .send(body);
    const second = await request(app)
      .post("/api/crm/write")
      .set("Authorization", salesAuthHeader())
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.deduped).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.write.id).toBe(first.body.write.id);
    expect(second.body.write.afterImage).toEqual(first.body.write.afterImage);

    // Proven at the database level, not just via HTTP status codes.
    const writeRows = await scopedPool.query(
      "SELECT * FROM crm_writes WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    expect(writeRows.rows).toHaveLength(1);

    const clientState = await scopedPool.query("SELECT name, contact_info FROM clients WHERE id = $1", [
      clientId,
    ]);
    expect(clientState.rows[0].name).toBe("Beta Incorporated");
    expect(clientState.rows[0].contact_info).toEqual({ email: "new@beta.example" });

    const auditRows = await scopedPool.query(
      "SELECT step FROM crm_write_audit WHERE write_id = $1 ORDER BY recorded_at",
      [first.body.write.id],
    );
    expect(auditRows.rows.map((row: { step: string }) => row.step)).toEqual([
      "applied",
      "deduped",
    ]);
  });

  it("a repeat key on an already-rolled-back write still returns the stored (rolled-back) result, not a stale success", async () => {
    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Gamma LLC", { email: "gamma@example.com" }],
    );
    const clientId = clientRows[0].id as string;
    const idempotencyKey = randomUUID();
    const body = {
      idempotencyKey,
      clientId,
      name: "Gamma LLC (updated)",
      contactInfo: { email: "gamma@example.com" },
    };

    const applied = await request(app)
      .post("/api/crm/write")
      .set("Authorization", salesAuthHeader())
      .send(body);
    await request(app)
      .post(`/api/crm/write/${applied.body.write.id}/rollback`)
      .set("Authorization", adminAuthHeader());

    const repeat = await request(app)
      .post("/api/crm/write")
      .set("Authorization", salesAuthHeader())
      .send(body);

    expect(repeat.status).toBe(200);
    expect(repeat.body.deduped).toBe(true);
    expect(repeat.body.write.status).toBe("rolled_back");
  });
});
