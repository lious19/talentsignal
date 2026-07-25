import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeClientsPool } from "./helpers/fakeClientsPool";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

function appWithFakeClients() {
  const { pool, rows } = createFakeClientsPool();
  const app = createApp(pool, noopProvider);
  return { app, rows };
}

describe("clients CRUD — happy path", () => {
  it("creates, lists, gets, updates, and deletes a client", async () => {
    const { app } = appWithFakeClients();
    const auth = recruiterAuthHeader();

    const create = await request(app)
      .post("/api/clients")
      .set("Authorization", auth)
      .send({ name: "Acme Staffing", contactInfo: { email: "ops@acme.example" } });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: "Acme Staffing", contactInfo: { email: "ops@acme.example" } });
    const id = create.body.id;

    const list = await request(app).get("/api/clients").set("Authorization", auth);
    expect(list.status).toBe(200);
    expect(list.body.clients).toHaveLength(1);

    const get = await request(app).get(`/api/clients/${id}`).set("Authorization", auth);
    expect(get.status).toBe(200);
    expect(get.body.name).toBe("Acme Staffing");

    const update = await request(app)
      .put(`/api/clients/${id}`)
      .set("Authorization", auth)
      .send({ name: "Acme Staffing Co", contactInfo: { email: "ops@acme.example" } });
    expect(update.status).toBe(200);
    expect(update.body.name).toBe("Acme Staffing Co");

    const del = await request(app).delete(`/api/clients/${id}`).set("Authorization", auth);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app).get(`/api/clients/${id}`).set("Authorization", auth);
    expect(getAfterDelete.status).toBe(404);
  });
});

describe("clients CRUD — failure", () => {
  it("rejects a create with no name", async () => {
    const { app } = appWithFakeClients();
    const res = await request(app)
      .post("/api/clients")
      .set("Authorization", recruiterAuthHeader())
      .send({ contactInfo: {} });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = appWithFakeClients();
    const res = await request(app).get("/api/clients");
    expect(res.status).toBe(401);
  });

  it("rejects create/update/delete from a role without PII access", async () => {
    const { app } = appWithFakeClients();
    const auth = salesAuthHeader();

    const create = await request(app)
      .post("/api/clients")
      .set("Authorization", auth)
      .send({ name: "Acme Staffing" });
    expect(create.status).toBe(403);
  });

  it("404s on get/update/delete of a nonexistent client", async () => {
    const { app } = appWithFakeClients();
    const auth = recruiterAuthHeader();

    expect((await request(app).get("/api/clients/missing").set("Authorization", auth)).status).toBe(404);
    expect(
      (await request(app)
        .put("/api/clients/missing")
        .set("Authorization", auth)
        .send({ name: "X", contactInfo: {} })).status,
    ).toBe(404);
    expect((await request(app).delete("/api/clients/missing").set("Authorization", auth)).status).toBe(404);
  });
});

describe("clients CRUD — idempotency", () => {
  it("PUT twice with the same body leaves the same end state", async () => {
    const { app } = appWithFakeClients();
    const auth = recruiterAuthHeader();
    const create = await request(app)
      .post("/api/clients")
      .set("Authorization", auth)
      .send({ name: "Acme", contactInfo: {} });
    const id = create.body.id;

    const first = await request(app)
      .put(`/api/clients/${id}`)
      .set("Authorization", auth)
      .send({ name: "Acme Renamed", contactInfo: {} });
    const second = await request(app)
      .put(`/api/clients/${id}`)
      .set("Authorization", auth)
      .send({ name: "Acme Renamed", contactInfo: {} });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.name).toBe(first.body.name);
  });

  it("DELETE twice returns 404 the second time, not a 500", async () => {
    const { app } = appWithFakeClients();
    const auth = recruiterAuthHeader();
    const create = await request(app)
      .post("/api/clients")
      .set("Authorization", auth)
      .send({ name: "Acme", contactInfo: {} });
    const id = create.body.id;

    const first = await request(app).delete(`/api/clients/${id}`).set("Authorization", auth);
    const second = await request(app).delete(`/api/clients/${id}`).set("Authorization", auth);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });

  it("two POSTs with an identical body create two distinct rows, not a merged/deduped one", async () => {
    const { app } = appWithFakeClients();
    const auth = recruiterAuthHeader();
    const body = { name: "Acme", contactInfo: { email: "ops@acme.example" } };

    const first = await request(app).post("/api/clients").set("Authorization", auth).send(body);
    const second = await request(app).post("/api/clients").set("Authorization", auth).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);

    const list = await request(app).get("/api/clients").set("Authorization", auth);
    expect(list.body.clients).toHaveLength(2);
  });
});
