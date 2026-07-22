import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunitiesPool } from "./helpers/fakeOpportunitiesPool";
import { salesAuthHeader } from "./helpers/authHeader";
import type { MarketSignal, MarketSignalProvider } from "../src/adapters/marketSignalProvider";

const SIGNAL: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-1001",
  company: "Acme Corp",
  title: "Senior Recruiter",
  daysOpen: 24,
  isRepost: true,
  hasSalaryRange: false,
};

function fixedProvider(signals: MarketSignal[]): MarketSignalProvider {
  return { fetchSignals: async () => signals };
}

describe("POST /api/hidden-demand/analyze", () => {
  it("happy path: stores an opportunity with confidence score, source, and reasons", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(201);
    expect(res.body.opportunities).toHaveLength(1);
    const opportunity = res.body.opportunities[0];
    expect(opportunity.company).toBe("Acme Corp");
    expect(opportunity.source).toBe("mock-job-board");
    expect(typeof opportunity.confidenceScore).toBe("number");
    expect(opportunity.confidenceScore).toBeGreaterThan(0);
    expect(opportunity.reasons).toEqual(
      expect.arrayContaining(["reposted role", "open 24 days", "no salary range"]),
    );
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));

    const res = await request(app).post("/api/hidden-demand/analyze");

    expect(res.status).toBe(401);
  });

  it("idempotency: analyzing the same signal twice updates one row, not two", async () => {
    const { pool, rows } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));

    const first = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());
    const second = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(second.body.opportunities[0].confidenceScore).toBe(
      first.body.opportunities[0].confidenceScore,
    );
  });
});

describe("GET /api/hidden-demand/opportunities", () => {
  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));

    const res = await request(app).get("/api/hidden-demand/opportunities");

    expect(res.status).toBe(401);
  });

  it("lists a previously analyzed opportunity with confidence score and source", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));
    await request(app).post("/api/hidden-demand/analyze").set("Authorization", salesAuthHeader());

    const res = await request(app)
      .get("/api/hidden-demand/opportunities")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(1);
    expect(res.body.opportunities[0].source).toBe("mock-job-board");
  });
});
