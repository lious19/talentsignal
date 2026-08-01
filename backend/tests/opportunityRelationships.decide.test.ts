import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeRelationshipPool } from "./helpers/fakeRelationshipPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("POST /api/opportunities/:id/relationships/decide", () => {
  it("happy path: records a confirm decision with the authenticated user as decidedBy", async () => {
    const { pool, seedOpportunity, seedClient, seedEdge } = createFakeRelationshipPool();
    const client = seedClient({ name: "Acme Corp" });
    const opportunity = seedOpportunity({ company: "Acme Corp" });
    const edge = seedEdge({
      fromType: "user",
      fromId: "user-1",
      toType: "client",
      toId: client.id,
      relationshipType: "knows_contact",
      strength: "strong",
    });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: [edge.id], decision: "confirmed" });

    expect(res.status).toBe(200);
    expect(res.body.pathDecision.decision).toBe("confirmed");
    // salesAuthHeader signs sub "user-1" — see tests/helpers/authHeader.ts.
    expect(res.body.pathDecision.decidedBy).toBe("user-1");
  });

  it("returns 400 for a missing edgeIds", async () => {
    const { pool, seedOpportunity } = createFakeRelationshipPool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ decision: "confirmed" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty edgeIds array", async () => {
    const { pool, seedOpportunity } = createFakeRelationshipPool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: [], decision: "confirmed" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid decision value", async () => {
    const { pool, seedOpportunity } = createFakeRelationshipPool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: ["edge-1"], decision: "maybe" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for an opportunity that does not exist", async () => {
    const { pool } = createFakeRelationshipPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunities/does-not-exist/relationships/decide")
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: ["edge-1"], decision: "confirmed" });

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool, seedOpportunity } = createFakeRelationshipPool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .send({ edgeIds: ["edge-1"], decision: "confirmed" });

    expect(res.status).toBe(401);
  });
});
