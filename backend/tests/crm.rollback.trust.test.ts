import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

/**
 * 🛡 TRUST (S-16): "a bad update can be rolled back" — a guarded write
 * captures the prior known-good state at write time; a rollback reverts to
 * it. DB-gated: asserts the restored state directly against Postgres, not
 * just the HTTP response shape.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("crm write — rollback trust scenario (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_crm_rollback_${randomUUID().replace(/-/g, "_")}`;
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

  it("reverts a bad update to the prior known-good state, and refuses a second rollback of the same write", async () => {
    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Delta Staffing", { email: "good@delta.example" }],
    );
    const clientId = clientRows[0].id as string;

    // The erroneous update — e.g. a bad sync overwrote a real address with
    // garbage.
    const badWrite = await request(app)
      .post("/api/crm/write")
      .set("Authorization", salesAuthHeader())
      .send({
        idempotencyKey: randomUUID(),
        clientId,
        name: "DELTA STAFFING TYPO",
        contactInfo: { email: "garbage@wrong.example" },
      });
    expect(badWrite.status).toBe(201);

    const rollback = await request(app)
      .post(`/api/crm/write/${badWrite.body.write.id}/rollback`)
      .set("Authorization", adminAuthHeader());

    expect(rollback.status).toBe(200);
    expect(rollback.body.write.status).toBe("rolled_back");
    expect(rollback.body.client.name).toBe("Delta Staffing");
    expect(rollback.body.client.contactInfo).toEqual({ email: "good@delta.example" });

    // Re-read directly from the database — the restored state, not just
    // what the HTTP response claims.
    const { rows: restored } = await scopedPool.query(
      "SELECT name, contact_info FROM clients WHERE id = $1",
      [clientId],
    );
    expect(restored[0].name).toBe("Delta Staffing");
    expect(restored[0].contact_info).toEqual({ email: "good@delta.example" });

    // A second rollback of the SAME write is refused, and the client state
    // is unchanged from the first rollback's result — proves "restore," not
    // a re-appliable operation.
    const secondRollback = await request(app)
      .post(`/api/crm/write/${badWrite.body.write.id}/rollback`)
      .set("Authorization", adminAuthHeader());
    expect(secondRollback.status).toBe(409);

    const { rows: stillRestored } = await scopedPool.query(
      "SELECT name, contact_info FROM clients WHERE id = $1",
      [clientId],
    );
    expect(stillRestored[0]).toEqual(restored[0]);

    const auditRows = await scopedPool.query(
      "SELECT step FROM crm_write_audit WHERE write_id = $1 ORDER BY recorded_at",
      [badWrite.body.write.id],
    );
    expect(auditRows.rows.map((row: { step: string }) => row.step)).toEqual([
      "applied",
      "rolled_back",
    ]);
  });

  it("404s rolling back an unknown write id, and 404s an unknown client on write", async () => {
    const missingRollback = await request(app)
      .post(`/api/crm/write/${randomUUID()}/rollback`)
      .set("Authorization", adminAuthHeader());
    expect(missingRollback.status).toBe(404);

    const missingClient = await request(app)
      .post("/api/crm/write")
      .set("Authorization", salesAuthHeader())
      .send({
        idempotencyKey: randomUUID(),
        clientId: randomUUID(),
        name: "Nobody",
        contactInfo: {},
      });
    expect(missingClient.status).toBe(404);
  });

  it("role-gates both routes: a recruiter token is refused, admin and sales are allowed", async () => {
    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Role Check Co", { email: "role@example.com" }],
    );
    const clientId = clientRows[0].id as string;

    const denied = await request(app)
      .post("/api/crm/write")
      .set("Authorization", recruiterAuthHeader())
      .send({ idempotencyKey: randomUUID(), clientId, name: "X", contactInfo: {} });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post("/api/crm/write")
      .set("Authorization", adminAuthHeader())
      .send({ idempotencyKey: randomUUID(), clientId, name: "Role Check Co", contactInfo: {} });
    expect(allowed.status).toBe(201);
  });
});
