import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeSalesPipelinePool } from "./helpers/fakeSalesPipelinePool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("POST /api/sales-pipeline/update", () => {
  it("happy path: enrolls a brand-new client at prospecting, from_stage null", async () => {
    const { pool, seedClient, salesPipelineAudit } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient("Acme Corp");

    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.pipeline.clientId).toBe(client.id);
    expect(res.body.pipeline.status).toBe("prospecting");
    expect(salesPipelineAudit).toHaveLength(1);
    expect(salesPipelineAudit[0].from_stage).toBeNull();
    expect(salesPipelineAudit[0].to_stage).toBe("prospecting");
  });

  it("happy path: transitions an existing client to a new stage", async () => {
    const { pool, seedClient } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient("Acme Corp");

    await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });
    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "contacted" });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.pipeline.status).toBe("contacted");
  });

  it("rejects an unauthenticated request", async () => {
    const { pool, seedClient } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient();

    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .send({ clientId: client.id, toStage: "prospecting" });

    expect(res.status).toBe(401);
  });

  it("rejects an invalid stage", async () => {
    const { pool, seedClient } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient();

    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "won" });

    expect(res.status).toBe(400);
  });

  it("rejects a missing clientId", async () => {
    const { pool } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ toStage: "prospecting" });

    expect(res.status).toBe(400);
  });

  it("400s a foreign-key violation for an unknown client", async () => {
    const { pool } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: "does-not-exist", toStage: "prospecting" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("client not found");
  });

  it("idempotency: setting the same stage twice is a no-op the second time, no duplicate audit row", async () => {
    const { pool, seedClient, salesPipelineAudit } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient();

    const first = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });
    const second = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });

    expect(first.body.changed).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.changed).toBe(false);
    expect(salesPipelineAudit).toHaveLength(1);
  });

  it("freeform: allows a direct jump from prospecting to closed", async () => {
    const { pool, seedClient, salesPipelineAudit } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient();

    await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });
    const res = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "closed" });

    expect(res.status).toBe(200);
    expect(res.body.pipeline.status).toBe("closed");
    expect(salesPipelineAudit).toHaveLength(2);
    expect(salesPipelineAudit[1].from_stage).toBe("prospecting");
    expect(salesPipelineAudit[1].to_stage).toBe("closed");
  });
});

describe("GET /api/sales-pipeline", () => {
  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/sales-pipeline");

    expect(res.status).toBe(401);
  });

  it("lists enrolled clients with their current stage and client name", async () => {
    const { pool, seedClient } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient("Acme Corp");
    await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });

    const res = await request(app)
      .get("/api/sales-pipeline")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.pipeline).toHaveLength(1);
    expect(res.body.pipeline[0].clientName).toBe("Acme Corp");
    expect(res.body.pipeline[0].status).toBe("prospecting");
  });
});
