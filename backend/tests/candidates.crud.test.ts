import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeCandidatesPool } from "./helpers/fakeCandidatesPool";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

function appWithFakeCandidates() {
  const { pool, rows } = createFakeCandidatesPool();
  const app = createApp(pool, noopProvider);
  return { app, rows };
}

describe("candidates CRUD — happy path", () => {
  it("creates, lists, gets, updates, and deletes a candidate", async () => {
    const { app } = appWithFakeCandidates();
    const auth = recruiterAuthHeader();

    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({
        name: "Jordan Rivera",
        skills: ["python", "sql"],
        experience: 5,
        availability: "2 weeks notice",
        contactInfo: { email: "jordan@example.com" },
      });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      name: "Jordan Rivera",
      skills: ["python", "sql"],
      experience: 5,
      contactInfo: { email: "jordan@example.com" },
    });
    const id = create.body.id;

    const list = await request(app).get("/api/candidates").set("Authorization", auth);
    expect(list.status).toBe(200);
    expect(list.body.candidates).toHaveLength(1);

    const get = await request(app).get(`/api/candidates/${id}`).set("Authorization", auth);
    expect(get.status).toBe(200);
    expect(get.body.name).toBe("Jordan Rivera");

    const update = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({
        name: "Jordan Rivera",
        skills: ["python", "sql", "typescript"],
        experience: 6,
        availability: "immediate",
        contactInfo: { email: "jordan@example.com" },
      });
    expect(update.status).toBe(200);
    expect(update.body.skills).toEqual(["python", "sql", "typescript"]);

    const del = await request(app).delete(`/api/candidates/${id}`).set("Authorization", auth);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/candidates/${id}`)
      .set("Authorization", auth);
    expect(getAfterDelete.status).toBe(404);
  });
});

describe("candidates CRUD — failure", () => {
  it("rejects a create with no name", async () => {
    const { app } = appWithFakeCandidates();
    const res = await request(app)
      .post("/api/candidates")
      .set("Authorization", recruiterAuthHeader())
      .send({ skills: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a create with a non-array skills field", async () => {
    const { app } = appWithFakeCandidates();
    const res = await request(app)
      .post("/api/candidates")
      .set("Authorization", recruiterAuthHeader())
      .send({ name: "Jordan Rivera", skills: "python" });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = appWithFakeCandidates();
    const res = await request(app).get("/api/candidates");
    expect(res.status).toBe(401);
  });

  it("rejects create from a role without PII access", async () => {
    const { app } = appWithFakeCandidates();
    const res = await request(app)
      .post("/api/candidates")
      .set("Authorization", salesAuthHeader())
      .send({ name: "Jordan Rivera" });
    expect(res.status).toBe(403);
  });

  it("404s on get/update/delete of a nonexistent candidate", async () => {
    const { app } = appWithFakeCandidates();
    const auth = recruiterAuthHeader();

    expect(
      (await request(app).get("/api/candidates/missing").set("Authorization", auth)).status,
    ).toBe(404);
    expect(
      (await request(app)
        .put("/api/candidates/missing")
        .set("Authorization", auth)
        .send({ name: "X" })).status,
    ).toBe(404);
    expect(
      (await request(app).delete("/api/candidates/missing").set("Authorization", auth)).status,
    ).toBe(404);
  });
});

describe("candidates CRUD — idempotency", () => {
  it("PUT twice with the same body leaves the same end state", async () => {
    const { app } = appWithFakeCandidates();
    const auth = recruiterAuthHeader();
    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({ name: "Jordan Rivera", skills: ["python"] });
    const id = create.body.id;

    const first = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Jordan Rivera", skills: ["python", "sql"] });
    const second = await request(app)
      .put(`/api/candidates/${id}`)
      .set("Authorization", auth)
      .send({ name: "Jordan Rivera", skills: ["python", "sql"] });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.skills).toEqual(first.body.skills);
  });

  it("DELETE twice returns 404 the second time, not a 500", async () => {
    const { app } = appWithFakeCandidates();
    const auth = recruiterAuthHeader();
    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({ name: "Jordan Rivera" });
    const id = create.body.id;

    const first = await request(app).delete(`/api/candidates/${id}`).set("Authorization", auth);
    const second = await request(app).delete(`/api/candidates/${id}`).set("Authorization", auth);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });

  it("two POSTs with an identical body create two distinct candidates — two people can share a name", async () => {
    const { app } = appWithFakeCandidates();
    const auth = recruiterAuthHeader();
    const body = { name: "Jordan Rivera", skills: ["python"] };

    const first = await request(app).post("/api/candidates").set("Authorization", auth).send(body);
    const second = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);

    const list = await request(app).get("/api/candidates").set("Authorization", auth);
    expect(list.body.candidates).toHaveLength(2);
  });
});
