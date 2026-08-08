import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader } from "./helpers/authHeader";

/**
 * S-15's other half of the trust scenario: "erasure requests are honored
 * and recorded," driven generically by looping the S-05 pii_fields registry
 * (06_decisions/023) — not a hardcoded column list. DB-gated for the same
 * reason as privacy.appendOnly.integration.test.ts: this needs a real
 * Postgres, real migrations, and a real registry.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("privacy erasure requests (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_privacy_erasure_${randomUUID().replace(/-/g, "_")}`;
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

  it("erases every registered candidate column per its strategy, and audits every step", async () => {
    const { rows: candidateRows } = await scopedPool.query(
      "INSERT INTO candidates (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Priya Nair", { email: "priya@example.com", phone: "555-0100" }],
    );
    const candidateId = candidateRows[0].id as string;

    const res = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "erasure" });

    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe("actioned");
    expect(res.body.result.columnsErased.sort()).toEqual(["contact_info", "name"]);

    const { rows } = await scopedPool.query(
      "SELECT name, contact_info FROM candidates WHERE id = $1",
      [candidateId],
    );
    expect(rows[0].contact_info).toEqual({});
    expect(rows[0].name).toBe("[erased]");

    const steps = await scopedPool.query(
      "SELECT step FROM privacy_audit_log WHERE request_id = $1 ORDER BY recorded_at",
      [res.body.request.id],
    );
    expect(steps.rows.map((row: { step: string }) => row.step)).toEqual([
      "submitted",
      "queued",
      "actioned",
    ]);
  });

  it("skips a retain_exempt column entirely, never attempting to touch it", async () => {
    // A synthetic registry row pointing retain_exempt at a column that does
    // NOT exist on candidates. If applyErasure ever attempted an UPDATE for
    // a retain_exempt row instead of skipping it outright, this column
    // would not exist to update and the whole request would fail — so a
    // 201 here is itself the proof the row was skipped, not attempted.
    await scopedPool.query(
      `INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display)
       VALUES ('candidates', 'ghost_column', 'identity', 'retain_exempt', false)`,
    );

    const { rows: candidateRows } = await scopedPool.query(
      "INSERT INTO candidates (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Tomas Weber", { email: "tomas@example.com" }],
    );
    const candidateId = candidateRows[0].id as string;

    const res = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "erasure" });

    expect(res.status).toBe(201);
    expect(res.body.result.columnsRetained).toEqual(["ghost_column"]);
    expect(res.body.result.columnsErased.sort()).toEqual(["contact_info", "name"]);
  });

  it("is idempotent: erasing an already-erased candidate is a no-op, safely repeatable", async () => {
    const { rows: candidateRows } = await scopedPool.query(
      "INSERT INTO candidates (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Second Pass", { email: "second@example.com" }],
    );
    const candidateId = candidateRows[0].id as string;

    const first = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "erasure" });
    const second = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "erasure" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Two independent, non-deduped request/audit trails — each a real event
    // — but the same end state in the database either way.
    expect(first.body.request.id).not.toBe(second.body.request.id);

    const { rows } = await scopedPool.query(
      "SELECT name, contact_info FROM candidates WHERE id = $1",
      [candidateId],
    );
    expect(rows[0].contact_info).toEqual({});
    expect(rows[0].name).toBe("[erased]");

    const requestCount = await scopedPool.query(
      "SELECT count(*) FROM privacy_requests WHERE subject_id = $1",
      [candidateId],
    );
    expect(Number(requestCount.rows[0].count)).toBe(2);
  });

  it("leaves a client's contact_info erased and untouched columns alone", async () => {
    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Acme Corp", { email: "ops@acme.example" }],
    );
    const clientId = clientRows[0].id as string;

    const res = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "client", subjectId: clientId, requestType: "erasure" });

    expect(res.status).toBe(201);
    expect(res.body.result.columnsErased).toEqual(["contact_info"]);

    const { rows } = await scopedPool.query("SELECT name, contact_info FROM clients WHERE id = $1", [
      clientId,
    ]);
    // clients.name is deliberately not PII (06_decisions/009) — untouched.
    expect(rows[0].name).toBe("Acme Corp");
    expect(rows[0].contact_info).toEqual({});
  });
});
