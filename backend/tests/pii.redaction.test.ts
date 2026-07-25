import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeClientsPool } from "./helpers/fakeClientsPool";
import { createFakeCandidatesPool } from "./helpers/fakeCandidatesPool";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

describe("trust scenario: PII is role-gated at the field level, not the whole record", () => {
  it("hides candidates.contactInfo from a sales-authed read but keeps name/skills visible", async () => {
    const { pool } = createFakeCandidatesPool();
    const app = createApp(pool, noopProvider);

    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", recruiterAuthHeader())
      .send({
        name: "Jordan Rivera",
        skills: ["python"],
        contactInfo: { email: "jordan@example.com" },
      });
    const id = create.body.id;

    const salesGet = await request(app)
      .get(`/api/candidates/${id}`)
      .set("Authorization", salesAuthHeader());
    expect(salesGet.status).toBe(200);
    expect(salesGet.body.name).toBe("Jordan Rivera");
    expect(salesGet.body.skills).toEqual(["python"]);
    expect(salesGet.body).not.toHaveProperty("contactInfo");

    const salesList = await request(app)
      .get("/api/candidates")
      .set("Authorization", salesAuthHeader());
    expect(salesList.body.candidates[0]).not.toHaveProperty("contactInfo");

    const recruiterGet = await request(app)
      .get(`/api/candidates/${id}`)
      .set("Authorization", recruiterAuthHeader());
    expect(recruiterGet.body.contactInfo).toEqual({ email: "jordan@example.com" });

    const adminGet = await request(app)
      .get(`/api/candidates/${id}`)
      .set("Authorization", adminAuthHeader());
    expect(adminGet.body.contactInfo).toEqual({ email: "jordan@example.com" });
  });

  it("hides clients.contactInfo from a sales-authed read but keeps name visible", async () => {
    const { pool } = createFakeClientsPool();
    const app = createApp(pool, noopProvider);

    const create = await request(app)
      .post("/api/clients")
      .set("Authorization", recruiterAuthHeader())
      .send({ name: "Acme Staffing", contactInfo: { email: "ops@acme.example" } });
    const id = create.body.id;

    const salesGet = await request(app)
      .get(`/api/clients/${id}`)
      .set("Authorization", salesAuthHeader());
    expect(salesGet.status).toBe(200);
    expect(salesGet.body.name).toBe("Acme Staffing");
    expect(salesGet.body).not.toHaveProperty("contactInfo");

    const recruiterGet = await request(app)
      .get(`/api/clients/${id}`)
      .set("Authorization", recruiterAuthHeader());
    expect(recruiterGet.body.contactInfo).toEqual({ email: "ops@acme.example" });
  });

  it("rejects a sales-authed write that carries contactInfo, on both candidates and clients", async () => {
    const { pool: candidatesPool } = createFakeCandidatesPool();
    const candidatesApp = createApp(candidatesPool, noopProvider);
    const candidateWrite = await request(candidatesApp)
      .post("/api/candidates")
      .set("Authorization", salesAuthHeader())
      .send({ name: "Jordan Rivera", contactInfo: { email: "jordan@example.com" } });
    expect(candidateWrite.status).toBe(403);

    const { pool: clientsPool } = createFakeClientsPool();
    const clientsApp = createApp(clientsPool, noopProvider);
    const clientWrite = await request(clientsApp)
      .post("/api/clients")
      .set("Authorization", salesAuthHeader())
      .send({ name: "Acme Staffing", contactInfo: { email: "ops@acme.example" } });
    expect(clientWrite.status).toBe(403);
  });
});
