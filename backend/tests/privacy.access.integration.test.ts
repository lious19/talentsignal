import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

/**
 * S-15's "right to access": what a person gets back when they ask "what do
 * you hold on me" — every pii_fields-registered column's current value from
 * the subject's own row (06_decisions/023), not a hardcoded shape. DB-gated
 * for the same reason as the other two privacy integration suites.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("privacy access requests (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_privacy_access_${randomUUID().replace(/-/g, "_")}`;
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

  it("returns exactly the registered PII fields, matching the database, and audits the trail", async () => {
    const { rows: candidateRows } = await scopedPool.query(
      "INSERT INTO candidates (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Dana Okafor", { email: "dana@example.com", phone: "555-0199" }],
    );
    const candidateId = candidateRows[0].id as string;

    const res = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "access" });

    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe("actioned");
    expect(res.body.result).toEqual({
      name: "Dana Okafor",
      contactInfo: { email: "dana@example.com", phone: "555-0199" },
    });

    const steps = await scopedPool.query(
      "SELECT step, detail FROM privacy_audit_log WHERE request_id = $1 ORDER BY recorded_at",
      [res.body.request.id],
    );
    expect(steps.rows.map((row: { step: string }) => row.step)).toEqual([
      "submitted",
      "queued",
      "actioned",
    ]);
    // The audit trail records WHICH columns were returned, never the values
    // themselves (06_decisions/023) — this is the assertion that proves it.
    const actionedDetail = steps.rows[2].detail as { columnsReturned: string[] };
    expect(actionedDetail.columnsReturned.sort()).toEqual(["contact_info", "name"]);
    expect(JSON.stringify(actionedDetail)).not.toContain("dana@example.com");
  });

  it("access is unconditional regardless of consent — an unconsented candidate is still returned in full", async () => {
    const { rows: candidateRows } = await scopedPool.query(
      "INSERT INTO candidates (name, contact_info, consent_given) VALUES ($1, $2, false) RETURNING id",
      ["No Consent Yet", { email: "noconsent@example.com" }],
    );
    const candidateId = candidateRows[0].id as string;

    const res = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "access" });

    expect(res.status).toBe(201);
    expect(res.body.result.contactInfo).toEqual({ email: "noconsent@example.com" });
  });

  it("404s for an unknown subject, and 400s for an invalid request shape", async () => {
    const missing = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: randomUUID(), requestType: "access" });
    expect(missing.status).toBe(404);

    const badType = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", recruiterAuthHeader())
      .send({ subjectType: "candidate", subjectId: randomUUID(), requestType: "delete-everything" });
    expect(badType.status).toBe(400);
  });

  it("role-gates the endpoint: a sales token is refused, admin and recruiter are allowed", async () => {
    const { rows: candidateRows } = await scopedPool.query(
      "INSERT INTO candidates (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Role Check", { email: "role@example.com" }],
    );
    const candidateId = candidateRows[0].id as string;

    const denied = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", salesAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "access" });
    expect(denied.status).toBe(403);

    const asAdmin = await request(app)
      .post("/api/privacy/request")
      .set("Authorization", adminAuthHeader())
      .send({ subjectType: "candidate", subjectId: candidateId, requestType: "access" });
    expect(asAdmin.status).toBe(201);

    const listDenied = await request(app)
      .get("/api/privacy/requests")
      .set("Authorization", salesAuthHeader());
    expect(listDenied.status).toBe(403);

    const listOk = await request(app)
      .get("/api/privacy/requests")
      .set("Authorization", adminAuthHeader());
    expect(listOk.status).toBe(200);
    expect(Array.isArray(listOk.body.requests)).toBe(true);
  });
});
