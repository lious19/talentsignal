import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeAnomalyPool } from "./helpers/fakeAnomalyPool";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

const MONTHS = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
  "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
];
// Naturally noisy baseline (not a clean +1/month ramp) — a mild spike here
// has a residual/std ratio (z ≈ 2.46) just above the base 2σ cutoff, so a
// SINGLE suppression step (2 -> 2.5σ, z ≈ 2.46 < 2.5) genuinely clears it.
// A more extreme single-point spike against a near-zero-residual baseline
// (tried first) inflates residualStd enough that its own z-score stays
// resistant to a single 0.5-step widening — verified numerically, not by
// guesswork, since the math is coupled (the spike itself feeds residualStd).
const TRENDING = [3, 4, 5, 4, 6, 5, 7, 6, 8, 7];

function seedMonth(seedAuditRow: (toStage: string, changedAt: string) => void, month: string, count: number) {
  for (let day = 1; day <= count; day++) {
    seedAuditRow("closed", `${month}-${String(day).padStart(2, "0")}T00:00:00Z`);
  }
}

function seedTrending(seedAuditRow: (toStage: string, changedAt: string) => void, counts = TRENDING) {
  MONTHS.forEach((month, i) => seedMonth(seedAuditRow, month, counts[i]));
}

describe("GET /api/analytics/anomalies", () => {
  it("returns anomalies with baselines and segments grouped by open role count", async () => {
    const { pool, seedAuditRow, seedClient } = createFakeAnomalyPool();
    const withSpike = [...TRENDING];
    withSpike[4] = 10;
    seedTrending(seedAuditRow, withSpike);
    seedClient("c1", "Low Co", 0);
    seedClient("c2", "High Co", 7);

    const app = createApp(pool, noopProvider);
    const res = await request(app).get("/api/analytics/anomalies").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.anomalies.status).toBe("ok");
    const spikePoint = res.body.anomalies.points.find((p: { month: string }) => p.month === MONTHS[4]);
    expect(spikePoint.isAnomaly).toBe(true);
    expect(spikePoint.baseline).toEqual(expect.any(Number));
    expect(spikePoint.decision).toBe("unconfirmed");

    expect(res.body.segments.dimension).toBe("hiring_volume");
    const bySegment = Object.fromEntries(
      res.body.segments.groups.map((g: { segment: string; clients: { id: string }[] }) => [
        g.segment,
        g.clients.map((c) => c.id),
      ]),
    );
    expect(bySegment.low).toEqual(["c1"]);
    expect(bySegment.high).toEqual(["c2"]);
  });

  it("returns insufficient-history gracefully, not a crash, when there is too little data", async () => {
    const { pool } = createFakeAnomalyPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/analytics/anomalies").set("Authorization", salesAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.anomalies.status).toBe("insufficient-history");
    expect(res.body.segments.groups).toEqual([]);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeAnomalyPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/analytics/anomalies");
    expect(res.status).toBe(401);
  });

  it("responds well within a generous latency ceiling", async () => {
    const { pool, seedAuditRow } = createFakeAnomalyPool();
    seedTrending(seedAuditRow);

    const app = createApp(pool, noopProvider);
    const startedAt = Date.now();
    const res = await request(app).get("/api/analytics/anomalies").set("Authorization", salesAuthHeader());

    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(res.status).toBe(200);
  });

  it("role-gates the view: recruiter (a viewer role, not a decider) is allowed to GET", async () => {
    const { pool } = createFakeAnomalyPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/analytics/anomalies").set("Authorization", recruiterAuthHeader());
    expect(res.status).toBe(200);
  });
});

describe("POST /api/analytics/anomalies/decide", () => {
  it("confirms an anomaly without moving the threshold — record-only", async () => {
    const { pool, seedAuditRow } = createFakeAnomalyPool();
    const withSpike = [...TRENDING];
    withSpike[4] = 10;
    seedTrending(seedAuditRow, withSpike);
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", salesAuthHeader())
      .send({ month: MONTHS[4], decision: "confirmed" });

    expect(res.status).toBe(200);
    // Confirming records the review but does not clear the flag or widen
    // the band — only suppression does either of those (06_decisions/025).
    expect(res.body.point.isAnomaly).toBe(true);
    expect(res.body.threshold.kStdDev).toBe(2);
  });

  it("suppresses an anomaly: the threshold widens and the point stops firing", async () => {
    const { pool, seedAuditRow } = createFakeAnomalyPool();
    const withSpike = [...TRENDING];
    withSpike[4] = 10;
    seedTrending(seedAuditRow, withSpike);
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", salesAuthHeader())
      .send({ month: MONTHS[4], decision: "suppressed" });

    expect(res.status).toBe(200);
    expect(res.body.threshold.kStdDev).toBe(2.5);
    expect(res.body.point.isAnomaly).toBe(false);
  });

  it("400s deciding on a point that is not currently flagged as an anomaly", async () => {
    const { pool, seedAuditRow } = createFakeAnomalyPool();
    seedTrending(seedAuditRow); // no spike anywhere
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", salesAuthHeader())
      .send({ month: MONTHS[4], decision: "confirmed" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid decision value", async () => {
    const { pool } = createFakeAnomalyPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", adminAuthHeader())
      .send({ month: "2026-01", decision: "maybe" });
    expect(res.status).toBe(400);
  });

  it("role-gates /decide narrower than the view: recruiter is refused, admin and sales are allowed", async () => {
    const { pool, seedAuditRow } = createFakeAnomalyPool();
    const withSpike = [...TRENDING];
    withSpike[4] = 10;
    seedTrending(seedAuditRow, withSpike);
    const app = createApp(pool, noopProvider);

    const denied = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", recruiterAuthHeader())
      .send({ month: MONTHS[4], decision: "confirmed" });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", adminAuthHeader())
      .send({ month: MONTHS[4], decision: "confirmed" });
    expect(allowed.status).toBe(200);
  });
});
