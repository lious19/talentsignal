import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunitiesPool } from "./helpers/fakeOpportunitiesPool";
import { salesAuthHeader } from "./helpers/authHeader";
import { upsertBatch, UPSERT_CHUNK_SIZE } from "../src/routes/hiddenDemand";
import type { MarketSignal, MarketSignalProvider } from "../src/adapters/marketSignalProvider";

function fixedProvider(signals: MarketSignal[]): MarketSignalProvider {
  return { fetchSignals: async () => signals };
}

// Chosen so every score is easy to hand-verify against CONFIDENCE_CONFIG
// (base 0.20, repostedRole 0.32, daysOpen 0.32 ramped to a 30-day cap,
// missingSalaryRange 0.16) without depending on its exact numbers changing.
const HIGH: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-high",
  company: "High Co",
  title: "Role",
  daysOpen: 30,
  isRepost: true,
  hasSalaryRange: false,
}; // 0.20 + 0.32 + 0.32 + 0.16 = 1.00

const MID: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-mid",
  company: "Mid Co",
  title: "Role",
  daysOpen: 15,
  isRepost: false,
  hasSalaryRange: true,
}; // 0.20 + 0.16 = 0.36

const TIE_B: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-tie-b",
  company: "Tie Co B",
  title: "Role",
  daysOpen: 0,
  isRepost: false,
  hasSalaryRange: true,
}; // 0.20, same as TIE_A

const TIE_A: MarketSignal = {
  ...TIE_B,
  externalId: "jb-tie-a",
  company: "Tie Co A",
}; // identical score to TIE_B — exercises the external_signal_id tiebreak

describe("POST /api/hidden-demand/analyze — batch ranking", () => {
  it("ranks a batch by confidence score descending, with the reasons behind each score", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([MID, HIGH, TIE_B, TIE_A]));

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(201);
    const companies = res.body.opportunities.map((o: { company: string }) => o.company);
    // HIGH first (1.00), MID next (0.36), then the tied pair (0.20 each) —
    // tiebroken on external_signal_id ("jb-tie-a" < "jb-tie-b"), not
    // insertion order or created_at.
    expect(companies).toEqual(["High Co", "Mid Co", "Tie Co A", "Tie Co B"]);
    expect(res.body.opportunities[0].reasons).toEqual(
      expect.arrayContaining(["reposted role", "open 30 days", "no salary range"]),
    );
  });

  it("writes a batch of many signals in one query per chunk, not one query per signal", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const signals: MarketSignal[] = Array.from({ length: 500 }, (_, i) => ({
      source: "mock-job-board",
      externalId: `jb-${i}`,
      company: `Company ${i}`,
      title: "Role",
      daysOpen: i % 40,
      isRepost: i % 3 === 0,
      hasSalaryRange: i % 2 === 0,
    }));
    const app = createApp(pool, fixedProvider(signals));

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(201);
    expect(res.body.opportunities).toHaveLength(500);
    // requireAuth never touches the DB. 06_decisions/042 (updated): 500
    // signals chunk into 5 x 100 (UPSERT_CHUNK_SIZE), one query per chunk —
    // a regression back to a per-row loop would make this 500, not 5.
    expect(pool.query).toHaveBeenCalledTimes(5);
  });

  it("06_decisions/042: 500 signals issue exactly 5 chunked SQL statements (100 x 5), not 1", async () => {
    const { pool } = createFakeOpportunitiesPool();
    expect(UPSERT_CHUNK_SIZE).toBe(100);
    const signals: MarketSignal[] = Array.from({ length: 500 }, (_, i) => ({
      source: "mock-job-board",
      externalId: `chunk-${i}`,
      company: `Company ${i}`,
      title: "Role",
      daysOpen: i % 40,
      isRepost: i % 3 === 0,
      hasSalaryRange: i % 2 === 0,
    }));

    const opportunities = await upsertBatch(pool, signals);

    expect(opportunities).toHaveLength(500);
    expect(pool.query).toHaveBeenCalledTimes(5);
    const callSizes = (pool.query as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (call) => (call[1] as unknown[][])[0].length,
    );
    expect(callSizes).toEqual([100, 100, 100, 100, 100]);
  });

  it("idempotency: re-analyzing the same batch updates rows, not duplicates them", async () => {
    const { pool, rows } = createFakeOpportunitiesPool();
    const signals = [HIGH, MID, TIE_A, TIE_B];
    const app = createApp(pool, fixedProvider(signals));

    const first = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());
    const second = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(rows).toHaveLength(signals.length);
    expect(second.body.opportunities.map((o: { company: string }) => o.company)).toEqual(
      first.body.opportunities.map((o: { company: string }) => o.company),
    );
  });
});

describe("GET /api/hidden-demand/opportunities — ranking and seed filtering", () => {
  it("lists opportunities ranked by confidence score, not insertion order", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const app = createApp(pool, fixedProvider([MID, HIGH]));
    await request(app).post("/api/hidden-demand/analyze").set("Authorization", salesAuthHeader());

    const res = await request(app)
      .get("/api/hidden-demand/opportunities")
      .set("Authorization", salesAuthHeader());

    expect(res.body.opportunities.map((o: { company: string }) => o.company)).toEqual([
      "High Co",
      "Mid Co",
    ]);
  });

  it("hides seed-job-board rows by default, and shows them with includeSeedData=true", async () => {
    const { pool } = createFakeOpportunitiesPool();
    const seedSignal: MarketSignal = { ...MID, source: "seed-job-board", externalId: "seed-0" };
    const app = createApp(pool, fixedProvider([HIGH, seedSignal]));
    await request(app).post("/api/hidden-demand/analyze").set("Authorization", salesAuthHeader());

    const defaultRes = await request(app)
      .get("/api/hidden-demand/opportunities")
      .set("Authorization", salesAuthHeader());
    expect(defaultRes.body.opportunities.map((o: { company: string }) => o.company)).toEqual([
      "High Co",
    ]);

    const withSeedRes = await request(app)
      .get("/api/hidden-demand/opportunities?includeSeedData=true")
      .set("Authorization", salesAuthHeader());
    expect(withSeedRes.body.opportunities).toHaveLength(2);
  });
});
