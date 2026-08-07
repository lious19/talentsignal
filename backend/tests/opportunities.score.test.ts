import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunitiesPool } from "./helpers/fakeOpportunitiesPool";
import { recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";
import type { MarketSignal, MarketSignalProvider } from "../src/adapters/marketSignalProvider";

const SIGNAL: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-2001",
  company: "Beacon Staffing",
  title: "Recruiter",
  daysOpen: 24,
  isRepost: true,
  hasSalaryRange: false,
};

function fixedProvider(signals: MarketSignal[]): MarketSignalProvider {
  return { fetchSignals: async () => signals };
}

async function seedOpportunity(app: ReturnType<typeof createApp>) {
  const res = await request(app)
    .post("/api/hidden-demand/analyze")
    .set("Authorization", salesAuthHeader());
  return res.body.opportunities[0] as { id: string };
}

describe("POST /api/opportunities/score", () => {
  it("happy path: returns the stored score, factor breakdown, and weights version for a known id", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));
    const seeded = await seedOpportunity(app);

    const res = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityIds: [seeded.id] });

    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(1);
    const opportunity = res.body.opportunities[0];
    expect(opportunity.id).toBe(seeded.id);
    expect(typeof opportunity.confidenceScore).toBe("number");
    expect(typeof opportunity.weightsVersion).toBe("string");
    expect(opportunity.factors).toHaveLength(4);
    expect(opportunity.factors.map((f: { factor: string }) => f.factor)).toEqual(
      expect.arrayContaining(["baseScore", "daysOpen", "repostedRole", "missingSalaryRange"]),
    );
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));

    const res = await request(app).post("/api/opportunities/score").send({ opportunityIds: ["1"] });

    expect(res.status).toBe(401);
  });

  it("rejects a request with no opportunityIds", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));

    const res = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it("omits unknown ids from the response rather than erroring", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));
    const seeded = await seedOpportunity(app);

    const res = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityIds: [seeded.id, "does-not-exist"] });

    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(1);
    expect(res.body.opportunities[0].id).toBe(seeded.id);
  });

  it("is idempotent: scoring the same opportunity id twice returns an identical body", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));
    const seeded = await seedOpportunity(app);

    // This route is read-only (a plain SELECT, no write), so nothing mutates
    // updated_at between these two calls — unlike re-analyzing, a full-body
    // toEqual is safe here.
    const first = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityIds: [seeded.id] });
    const second = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityIds: [seeded.id] });

    expect(second.body).toEqual(first.body);
  });

  // 06_decisions/022: admin/sales only — feeds the same queue as S-04.
  it("rejects a recruiter role with 403", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([SIGNAL]));
    const seeded = await seedOpportunity(app);

    const res = await request(app)
      .post("/api/opportunities/score")
      .set("Authorization", recruiterAuthHeader())
      .send({ opportunityIds: [seeded.id] });

    expect(res.status).toBe(403);
  });
});
