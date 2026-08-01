import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeRelationshipPool } from "./helpers/fakeRelationshipPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("GET /api/opportunities/:id/relationships", () => {
  it("happy path: ranks a direct strong 1-hop path above a 2-hop path through a colleague", async () => {
    const { pool, seedOpportunity, seedClient, seedEdge } = createFakeRelationshipPool();
    const client = seedClient({ name: "Acme Corp" });
    const opportunity = seedOpportunity({ company: "Acme Corp" });
    const directEdge = seedEdge({
      fromType: "user",
      fromId: "user-1",
      toType: "client",
      toId: client.id,
      relationshipType: "knows_contact",
      strength: "strong",
    });
    const colleagueEdge = seedEdge({
      fromType: "user",
      fromId: "user-2",
      toType: "user",
      toId: "user-1",
      relationshipType: "colleague",
      strength: "weak",
    });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.client.id).toBe(client.id);
    expect(res.body.paths).toHaveLength(2);

    const [first, second] = res.body.paths;
    // Worked example from 06_decisions/018: strong=0.8, weak=0.4, hop penalty=0.6.
    expect(first.hops).toBe(1);
    expect(first.confidence).toBe(0.8);
    expect(first.edgeIds).toEqual([directEdge.id]);
    expect(first.status).toBe("unconfirmed");
    expect(first.factors).toHaveLength(1);

    expect(second.hops).toBe(2);
    expect(second.confidence).toBeCloseTo(0.192, 5);
    expect(second.edgeIds.sort()).toEqual([colleagueEdge.id, directEdge.id].sort());
    expect(second.userIds).toEqual(["user-2", "user-1"]);
    // 2 edge factors + 1 hop-penalty factor.
    expect(second.factors).toHaveLength(3);
  });

  it("returns client: null, paths: [] when no client name matches the opportunity's company", async () => {
    const { pool, seedOpportunity } = createFakeRelationshipPool();
    const opportunity = seedOpportunity({ company: "Nobody Knows This Company" });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ client: null, paths: [] });
  });

  it("matches the client name case-insensitively", async () => {
    const { pool, seedOpportunity, seedClient } = createFakeRelationshipPool();
    seedClient({ name: "Acme Corp" });
    const opportunity = seedOpportunity({ company: "ACME CORP" });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.client).not.toBeNull();
  });

  it("returns 404 for an opportunity that does not exist", async () => {
    const { pool } = createFakeRelationshipPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/opportunities/does-not-exist/relationships")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool, seedOpportunity } = createFakeRelationshipPool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get(`/api/opportunities/${opportunity.id}/relationships`);

    expect(res.status).toBe(401);
  });

  it("returns an empty paths list when a client matches but has no edges", async () => {
    const { pool, seedOpportunity, seedClient } = createFakeRelationshipPool();
    seedClient({ name: "Acme Corp" });
    const opportunity = seedOpportunity({ company: "Acme Corp" });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.paths).toEqual([]);
  });
});
