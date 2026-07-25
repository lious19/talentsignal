import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeJobOpeningsPool } from "./helpers/fakeJobOpeningsPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

const CLIENT_ID = "client-1";

function appWithFakeJobOpenings() {
  const { pool, rows, clientIds } = createFakeJobOpeningsPool([CLIENT_ID]);
  const app = createApp(pool, noopProvider);
  return { app, rows, clientIds };
}

describe("job openings CRUD — happy path", () => {
  it("creates, lists, gets, updates, and deletes a job opening — no PII, no role gate", async () => {
    const { app } = appWithFakeJobOpenings();
    // Sales specifically, to prove there's no role gate on this entity —
    // S-06 needs sales to read (and here, create) job openings.
    const auth = salesAuthHeader();

    const create = await request(app)
      .post("/api/job-openings")
      .set("Authorization", auth)
      .send({ clientId: CLIENT_ID, title: "Backend Engineer", requirements: ["node", "postgres"] });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      clientId: CLIENT_ID,
      title: "Backend Engineer",
      requirements: ["node", "postgres"],
    });
    const id = create.body.id;

    const list = await request(app).get("/api/job-openings").set("Authorization", auth);
    expect(list.status).toBe(200);
    expect(list.body.jobOpenings).toHaveLength(1);

    const get = await request(app).get(`/api/job-openings/${id}`).set("Authorization", auth);
    expect(get.status).toBe(200);
    expect(get.body.title).toBe("Backend Engineer");

    const update = await request(app)
      .put(`/api/job-openings/${id}`)
      .set("Authorization", auth)
      .send({ clientId: CLIENT_ID, title: "Senior Backend Engineer", requirements: ["node"] });
    expect(update.status).toBe(200);
    expect(update.body.title).toBe("Senior Backend Engineer");

    const del = await request(app).delete(`/api/job-openings/${id}`).set("Authorization", auth);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/job-openings/${id}`)
      .set("Authorization", auth);
    expect(getAfterDelete.status).toBe(404);
  });
});

describe("job openings CRUD — failure", () => {
  it("rejects a create with no title", async () => {
    const { app } = appWithFakeJobOpenings();
    const res = await request(app)
      .post("/api/job-openings")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: CLIENT_ID });
    expect(res.status).toBe(400);
  });

  it("400s a job opening against a client that doesn't exist, instead of a raw 500", async () => {
    const { app } = appWithFakeJobOpenings();
    const res = await request(app)
      .post("/api/job-openings")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: "no-such-client", title: "Backend Engineer" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/client/i);
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = appWithFakeJobOpenings();
    const res = await request(app).get("/api/job-openings");
    expect(res.status).toBe(401);
  });

  it("404s on get/update/delete of a nonexistent job opening", async () => {
    const { app } = appWithFakeJobOpenings();
    const auth = salesAuthHeader();

    expect(
      (await request(app).get("/api/job-openings/missing").set("Authorization", auth)).status,
    ).toBe(404);
    expect(
      (await request(app)
        .put("/api/job-openings/missing")
        .set("Authorization", auth)
        .send({ clientId: CLIENT_ID, title: "X" })).status,
    ).toBe(404);
    expect(
      (await request(app).delete("/api/job-openings/missing").set("Authorization", auth)).status,
    ).toBe(404);
  });
});

describe("job openings CRUD — idempotency", () => {
  it("PUT twice with the same body leaves the same end state", async () => {
    const { app } = appWithFakeJobOpenings();
    const auth = salesAuthHeader();
    const create = await request(app)
      .post("/api/job-openings")
      .set("Authorization", auth)
      .send({ clientId: CLIENT_ID, title: "Backend Engineer" });
    const id = create.body.id;

    const first = await request(app)
      .put(`/api/job-openings/${id}`)
      .set("Authorization", auth)
      .send({ clientId: CLIENT_ID, title: "Staff Backend Engineer" });
    const second = await request(app)
      .put(`/api/job-openings/${id}`)
      .set("Authorization", auth)
      .send({ clientId: CLIENT_ID, title: "Staff Backend Engineer" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.title).toBe(first.body.title);
  });

  it("DELETE twice returns 404 the second time, not a 500", async () => {
    const { app } = appWithFakeJobOpenings();
    const auth = salesAuthHeader();
    const create = await request(app)
      .post("/api/job-openings")
      .set("Authorization", auth)
      .send({ clientId: CLIENT_ID, title: "Backend Engineer" });
    const id = create.body.id;

    const first = await request(app).delete(`/api/job-openings/${id}`).set("Authorization", auth);
    const second = await request(app).delete(`/api/job-openings/${id}`).set("Authorization", auth);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });

  it("two POSTs with an identical body create two distinct job openings", async () => {
    const { app } = appWithFakeJobOpenings();
    const auth = salesAuthHeader();
    const body = { clientId: CLIENT_ID, title: "Backend Engineer" };

    const first = await request(app).post("/api/job-openings").set("Authorization", auth).send(body);
    const second = await request(app)
      .post("/api/job-openings")
      .set("Authorization", auth)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);

    const list = await request(app).get("/api/job-openings").set("Authorization", auth);
    expect(list.body.jobOpenings).toHaveLength(2);
  });
});
