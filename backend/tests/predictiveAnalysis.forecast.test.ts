import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeAnalyticsPool } from "./helpers/fakeAnalyticsPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("POST /api/predictive-analysis/forecast", () => {
  it("returns a forecast with a confidence band from seeded closing history", async () => {
    const { pool, seedAuditRow } = createFakeAnalyticsPool();

    // Four months of closings — enough history (>= FORECAST_CONFIG.minHistoryMonths) to fit a trend.
    seedAuditRow({ clientId: "c1", fromStage: "prospecting", toStage: "closed", changedAt: "2026-01-15T00:00:00Z" });
    seedAuditRow({ clientId: "c2", fromStage: "prospecting", toStage: "closed", changedAt: "2026-02-10T00:00:00Z" });
    seedAuditRow({ clientId: "c3", fromStage: "prospecting", toStage: "closed", changedAt: "2026-02-20T00:00:00Z" });
    seedAuditRow({ clientId: "c4", fromStage: "prospecting", toStage: "closed", changedAt: "2026-03-05T00:00:00Z" });
    seedAuditRow({ clientId: "c5", fromStage: "prospecting", toStage: "closed", changedAt: "2026-03-25T00:00:00Z" });
    seedAuditRow({ clientId: "c6", fromStage: "prospecting", toStage: "closed", changedAt: "2026-03-28T00:00:00Z" });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .post("/api/predictive-analysis/forecast")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.historical).toEqual([
      { month: "2026-01", count: 1, fitted: expect.any(Number), residual: expect.any(Number), isOutlier: expect.any(Boolean) },
      { month: "2026-02", count: 2, fitted: expect.any(Number), residual: expect.any(Number), isOutlier: expect.any(Boolean) },
      { month: "2026-03", count: 3, fitted: expect.any(Number), residual: expect.any(Number), isOutlier: expect.any(Boolean) },
    ]);
    expect(res.body.forecast.length).toBeGreaterThan(0);
    for (const point of res.body.forecast) {
      expect(point.lowerBound).toBeLessThanOrEqual(point.upperBound);
    }
  });

  it("returns insufficient-history gracefully, not a crash, when there is too little data", async () => {
    const { pool } = createFakeAnalyticsPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/predictive-analysis/forecast")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("insufficient-history");
    expect(res.body.monthsAvailable).toBe(0);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeAnalyticsPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).post("/api/predictive-analysis/forecast");

    expect(res.status).toBe(401);
  });

  it("responds well within the 10s latency target (AC-4-8)", async () => {
    const { pool, seedAuditRow } = createFakeAnalyticsPool();
    seedAuditRow({ clientId: "c1", fromStage: "prospecting", toStage: "closed", changedAt: "2026-01-15T00:00:00Z" });
    seedAuditRow({ clientId: "c2", fromStage: "prospecting", toStage: "closed", changedAt: "2026-02-10T00:00:00Z" });
    seedAuditRow({ clientId: "c3", fromStage: "prospecting", toStage: "closed", changedAt: "2026-03-05T00:00:00Z" });

    const app = createApp(pool, noopProvider);
    const startedAt = Date.now();
    const res = await request(app)
      .post("/api/predictive-analysis/forecast")
      .set("Authorization", salesAuthHeader());

    // Soft, non-blocking assertion (S-04/S-06/S-12 convention) — this is
    // measuring against an in-memory fake pool, so 10s is a generous ceiling,
    // not a tight bound.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(res.status).toBe(200);
  });
});
