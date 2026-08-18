import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunitiesPool } from "./helpers/fakeOpportunitiesPool";
import { salesAuthHeader } from "./helpers/authHeader";
import type { MarketSignal, MarketSignalProvider } from "../src/adapters/marketSignalProvider";

// A role on HARD_TO_FILL_CONFIG.roleKeywords ("data analyst"), open to the
// 30-day saturation point and reposted: roleScarcity 0.6 + daysOpen 0.2 +
// repost 0.2 = 1.0, comfortably over the 0.5 threshold — the flagged case.
const HARD_TO_FILL_SIGNAL: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-htf-1",
  company: "Insight Analytics",
  title: "Senior Data Analyst",
  daysOpen: 30,
  isRepost: true,
  hasSalaryRange: false,
};

// A generic title (no keyword match) that is old and reposted: 0 + 0.16 + 0.2
// = 0.36, deliberately under 0.5 — the two reinforcers alone can't flag a
// role, which is the whole point of the threshold (06_decisions/026).
const GENERIC_SIGNAL: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-generic-1",
  company: "Acme Corp",
  title: "Senior Recruiter",
  daysOpen: 24,
  isRepost: true,
  hasSalaryRange: false,
};

function fixedProvider(signals: MarketSignal[]): MarketSignalProvider {
  return { fetchSignals: async () => signals };
}

describe("HF-2: hard-to-fill score on opportunities", () => {
  it("flags a hard-to-fill role and carries its reason, never a bare flag (trust)", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([HARD_TO_FILL_SIGNAL]));

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(201);
    const opp = res.body.opportunities[0];
    expect(opp.hardToFill).toBe(true);
    expect(opp.hardToFillScore).toBeGreaterThanOrEqual(0.5);
    // The flag never travels without its "why": reasons are non-empty and name
    // the role-type match that drove it.
    expect(opp.hardToFillReasons).toEqual(
      expect.arrayContaining(["in-demand role type", "open 30 days", "reposted role"]),
    );
    expect(typeof opp.hardToFillVersion).toBe("string");
  });

  it("always includes the factor breakdown, even when NOT flagged (trust)", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([GENERIC_SIGNAL]));

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    const opp = res.body.opportunities[0];
    expect(opp.hardToFill).toBe(false);
    expect(opp.hardToFillScore).toBeLessThan(0.5);
    // A visible zero-value row is more auditable than an omitted one: the
    // three-factor breakdown is present whether or not the badge shows.
    expect(opp.hardToFillFactors).toHaveLength(3);
    expect(opp.hardToFillFactors.map((f: { factor: string }) => f.factor)).toEqual(
      expect.arrayContaining(["roleScarcity", "daysOpen", "repostedRole"]),
    );
  });

  it("adds hard-to-fill WITHOUT changing the existing confidence score (no regression)", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([HARD_TO_FILL_SIGNAL]));

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    const opp = res.body.opportunities[0];
    // Confidence is untouched by HF-2: still a number > 0, still its own
    // four-factor breakdown from scoreSignal(). The two scores coexist.
    expect(typeof opp.confidenceScore).toBe("number");
    expect(opp.confidenceScore).toBeGreaterThan(0);
    expect(opp.factors).toHaveLength(4);
    expect(typeof opp.weightsVersion).toBe("string");
  });

  it("idempotency: re-analyzing keeps one row with the same hard-to-fill result", async () => {
    const { pool, rows } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([HARD_TO_FILL_SIGNAL]));

    const first = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());
    const second = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(rows).toHaveLength(1);
    const pick = (o: {
      hardToFill: boolean;
      hardToFillScore: number;
      hardToFillReasons: string[];
      hardToFillFactors: unknown;
      hardToFillVersion: string;
    }) => ({
      hardToFill: o.hardToFill,
      hardToFillScore: o.hardToFillScore,
      hardToFillReasons: o.hardToFillReasons,
      hardToFillFactors: o.hardToFillFactors,
      hardToFillVersion: o.hardToFillVersion,
    });
    expect(second.body.opportunities.map(pick)).toEqual(first.body.opportunities.map(pick));
  });

  it("GET /hidden-demand/opportunities returns the hard-to-fill fields too", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([HARD_TO_FILL_SIGNAL]));
    await request(app).post("/api/hidden-demand/analyze").set("Authorization", salesAuthHeader());

    const res = await request(app)
      .get("/api/hidden-demand/opportunities")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.opportunities[0].hardToFill).toBe(true);
    expect(res.body.opportunities[0].hardToFillReasons.length).toBeGreaterThan(0);
  });
});
