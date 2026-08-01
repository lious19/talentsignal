import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeRelationshipPool } from "./helpers/fakeRelationshipPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader, recruiterAuthHeader } from "./helpers/authHeader";

describe("TRUST — a surfaced relationship is a guess until a human confirms it", () => {
  it("distinguishes unconfirmed, confirmed, and dismissed paths for the same opportunity", async () => {
    const { pool, seedOpportunity, seedClient, seedEdge } = createFakeRelationshipPool();
    const client = seedClient({ name: "Acme Corp" });
    const opportunity = seedOpportunity({ company: "Acme Corp" });
    const strongPath = seedEdge({
      fromType: "user",
      fromId: "user-1",
      toType: "client",
      toId: client.id,
      relationshipType: "knows_contact",
      strength: "strong",
    });
    const otherUserEdge = seedEdge({
      fromType: "user",
      fromId: "user-2",
      toType: "client",
      toId: client.id,
      relationshipType: "knows_contact",
      strength: "weak",
    });
    const app = createApp(pool, noopProvider);

    const before = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());
    expect(before.body.paths.every((p: { status: string }) => p.status === "unconfirmed")).toBe(true);

    await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: [strongPath.id], decision: "confirmed" });
    await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: [otherUserEdge.id], decision: "dismissed" });

    const after = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());

    const byEdgeId = new Map(
      after.body.paths.map((p: { edgeIds: string[]; status: string }) => [p.edgeIds[0], p.status]),
    );
    expect(byEdgeId.get(strongPath.id)).toBe("confirmed");
    expect(byEdgeId.get(otherUserEdge.id)).toBe("dismissed");
    // Only the explicitly confirmed path counts as confirmed — dismissed and
    // unconfirmed are both, deliberately, "not confirmed."
    expect(byEdgeId.get(strongPath.id)).not.toBe(byEdgeId.get(otherUserEdge.id));
  });

  it("canonicalizes the path key: a decision recorded with edges in one order is still found regardless of order, and a repeat decision updates the same row instead of duplicating it", async () => {
    const { pool, seedOpportunity, seedClient, seedEdge, decisions } = createFakeRelationshipPool();
    const client = seedClient({ name: "Acme Corp" });
    const opportunity = seedOpportunity({ company: "Acme Corp" });
    seedEdge({
      fromType: "user",
      fromId: "user-1",
      toType: "client",
      toId: client.id,
      relationshipType: "knows_contact",
      strength: "strong",
    });
    seedEdge({
      fromType: "user",
      fromId: "user-2",
      toType: "user",
      toId: "user-1",
      relationshipType: "colleague",
      strength: "weak",
    });
    const app = createApp(pool, noopProvider);

    const initial = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());
    const twoHopPath = initial.body.paths.find((p: { hops: number }) => p.hops === 2);
    expect(twoHopPath).toBeDefined();

    // Confirm using the edges REVERSED relative to how the GET returned
    // them — simulating a client, or a future traversal-order change, that
    // doesn't preserve exact hop order. The route must canonicalize before
    // writing, not trust the caller's order.
    const reversedEdgeIds = [...twoHopPath.edgeIds].reverse();
    expect(reversedEdgeIds).not.toEqual(twoHopPath.edgeIds); // sanity: the reversal is genuine
    const firstConfirm = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", salesAuthHeader())
      .send({ edgeIds: reversedEdgeIds, decision: "confirmed" });
    expect(firstConfirm.status).toBe(200);

    // A later GET (the fake pool alternates the row order relationship_edges
    // comes back in — see fakeRelationshipPool's edgeQueryCount) must still
    // find this path and report it confirmed, not silently reverted to
    // unconfirmed because the edge order looked different this time.
    const afterConfirm = await request(app)
      .get(`/api/opportunities/${opportunity.id}/relationships`)
      .set("Authorization", salesAuthHeader());
    const stillTwoHop = afterConfirm.body.paths.find((p: { hops: number }) => p.hops === 2);
    expect(stillTwoHop.status).toBe("confirmed");

    // Re-confirming with the ORIGINAL (non-reversed) order must update the
    // same row, not insert a second one.
    const secondConfirm = await request(app)
      .post(`/api/opportunities/${opportunity.id}/relationships/decide`)
      .set("Authorization", recruiterAuthHeader())
      .send({ edgeIds: twoHopPath.edgeIds, decision: "confirmed" });
    expect(secondConfirm.status).toBe(200);

    const pathDecisions = decisions.filter(
      (d) => d.opportunity_id === opportunity.id && d.edge_ids.length === 2,
    );
    expect(pathDecisions).toHaveLength(1);
    expect(pathDecisions[0].decided_by).toBe("user-2"); // recruiterAuthHeader's sub
  });
});
