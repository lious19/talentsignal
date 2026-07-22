import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunitiesPool } from "./helpers/fakeOpportunitiesPool";
import { salesAuthHeader } from "./helpers/authHeader";
import type { MarketSignalProvider } from "../src/adapters/marketSignalProvider";

const failingProvider: MarketSignalProvider = {
  async fetchSignals() {
    throw new Error("job board API returned 500");
  },
};

const hangingProvider: MarketSignalProvider = {
  fetchSignals: () => new Promise(() => {}), // never resolves
};

describe("POST /api/hidden-demand/analyze — provider failure and timeout", () => {
  it("returns 502 when the provider rejects, and writes no row", async () => {
    const { pool, rows } = createFakeOpportunitiesPool();
    const app = createApp(pool, failingProvider);

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(502);
    expect(rows).toHaveLength(0);
  });

  it("returns 504 when the provider hangs past its timeout, and writes no row", async () => {
    const { pool, rows } = createFakeOpportunitiesPool();
    // A tiny timeout here — not the 5000ms production default — so this test
    // proves the same behavior without actually waiting 5 seconds.
    const app = createApp(pool, hangingProvider, { providerTimeoutMs: 50 });

    const res = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(504);
    expect(rows).toHaveLength(0);
  });
});
