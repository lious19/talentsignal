import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, salesAuthHeader } from "./helpers/authHeader";

function appWithFakeUsers() {
  const { pool, rows } = createFakeUsersPool();
  const app = createApp(pool, noopProvider);
  return { app, rows };
}

describe("POST /api/admin/users — closes the recruiter-account gap (06_decisions/010)", () => {
  it("an admin can create a recruiter account", async () => {
    const { app } = appWithFakeUsers();
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", adminAuthHeader())
      .send({ email: "new-recruiter@example.com", password: "correct-horse-battery", role: "recruiter" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "new-recruiter@example.com", role: "recruiter" });
  });

  it("rejects a non-admin caller", async () => {
    const { app } = appWithFakeUsers();
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", salesAuthHeader())
      .send({ email: "new-recruiter@example.com", password: "correct-horse-battery", role: "recruiter" });

    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated caller", async () => {
    const { app } = appWithFakeUsers();
    const res = await request(app)
      .post("/api/admin/users")
      .send({ email: "new-recruiter@example.com", password: "correct-horse-battery", role: "recruiter" });

    expect(res.status).toBe(401);
  });

  it("rejects an invalid role", async () => {
    const { app } = appWithFakeUsers();
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", adminAuthHeader())
      .send({ email: "new-user@example.com", password: "correct-horse-battery", role: "superuser" });

    expect(res.status).toBe(400);
  });

  it("409s a duplicate email, same as public registration", async () => {
    const { app } = appWithFakeUsers();
    const body = { email: "dup@example.com", password: "correct-horse-battery", role: "recruiter" };

    const first = await request(app).post("/api/admin/users").set("Authorization", adminAuthHeader()).send(body);
    const second = await request(app).post("/api/admin/users").set("Authorization", adminAuthHeader()).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });
});
