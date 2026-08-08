import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeCandidatesPool } from "./helpers/fakeCandidatesPool";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader } from "./helpers/authHeader";

/**
 * S-15's consent trust scenario (06_decisions/023): consent gates whether
 * contactInfo appears in the ordinary staff-facing candidate responses.
 * DEFAULT true is a documented pragmatic exception, not the GDPR-faithful
 * posture — the scenario that actually proves "consent gates use" is the
 * REVOKE round-trip below, independent of what the default happens to be.
 */
describe("consent gates contactInfo visibility on candidates", () => {
  it("omits contactInfo once consent is revoked, for admin and recruiter alike, and restores it when consent is re-granted", async () => {
    const { pool } = createFakeCandidatesPool();
    const app = createApp(pool, noopProvider);
    const auth = recruiterAuthHeader();

    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({ name: "Riley Chen", contactInfo: { email: "riley@example.com" } });
    const id = create.body.id;

    // Default consent is true (06_decisions/023) — contactInfo starts visible.
    expect(create.body.consentGiven).toBe(true);
    expect(create.body.contactInfo).toEqual({ email: "riley@example.com" });

    const revoke = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Riley Chen", contactInfo: { email: "riley@example.com" }, consent: false });
    expect(revoke.status).toBe(200);
    expect(revoke.body.consentGiven).toBe(false);
    expect(revoke.body.consentRecordedAt).not.toBeNull();
    expect(revoke.body).not.toHaveProperty("contactInfo");

    const adminGetAfterRevoke = await request(app)
      .get(`/api/candidates/${id}`)
      .set("Authorization", adminAuthHeader());
    expect(adminGetAfterRevoke.body).not.toHaveProperty("contactInfo");

    const restore = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Riley Chen", contactInfo: { email: "riley@example.com" }, consent: true });
    expect(restore.status).toBe(200);
    expect(restore.body.consentGiven).toBe(true);
    expect(restore.body.contactInfo).toEqual({ email: "riley@example.com" });
  });

  it("a PUT that omits consent entirely does not change the existing consent state", async () => {
    const { pool } = createFakeCandidatesPool();
    const app = createApp(pool, noopProvider);
    const auth = recruiterAuthHeader();

    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({ name: "Sam Okoye", contactInfo: { email: "sam@example.com" } });
    const id = create.body.id;

    await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Sam Okoye", contactInfo: { email: "sam@example.com" }, consent: false });

    // No `consent` field in this body at all — every existing PUT caller in
    // this codebase looks like this. It must not silently reset consent
    // back to true.
    const untouched = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Sam Okoye Jr.", contactInfo: { email: "sam@example.com" } });
    expect(untouched.status).toBe(200);
    expect(untouched.body.consentGiven).toBe(false);
    expect(untouched.body).not.toHaveProperty("contactInfo");
  });

  it("rejects a non-boolean consent value", async () => {
    const { pool } = createFakeCandidatesPool();
    const app = createApp(pool, noopProvider);
    const auth = recruiterAuthHeader();

    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({ name: "Bad Consent" });
    const id = create.body.id;

    const res = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Bad Consent", consent: "yes" });
    expect(res.status).toBe(400);
  });
});
