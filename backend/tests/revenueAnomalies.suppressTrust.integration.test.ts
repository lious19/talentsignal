import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";
import { ANOMALY_CONFIG } from "../src/scoring/anomalyConfig";

/**
 * 🛡 TRUST (S-17): "a human can confirm or suppress it and the threshold
 * learns, limiting alert fatigue." DB-gated because it must prove the
 * suppression is genuinely PERSISTED (a real anomaly_thresholds row, not an
 * in-memory fake) and genuinely AUDITED (a real anomaly_audit row behind the
 * real append-only trigger) — the same discipline S-16's
 * crm.rollback.trust.test.ts uses.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const MONTHS = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05",
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10",
];
const SPIKE_MONTH = "2025-05";
// Naturally noisy baseline (not a clean ramp) with a mild spike at index 4 —
// residual/std ratio z ≈ 2.46, numerically verified to sit just above the
// base 2σ cutoff but below 2.5σ, so a SINGLE suppression step genuinely
// clears it (06_decisions/025's own suppressionStepStdDev). A more extreme
// single-point spike against a near-zero-residual baseline inflates
// residualStd enough that its own z-score resists a single 0.5-step widen —
// the math is coupled (the spike feeds residualStd), so this was tuned
// numerically rather than guessed.
const COUNTS = [3, 4, 5, 4, 10, 5, 7, 6, 8, 7];

describeIfDb("revenue anomaly detector — suppress trust scenario (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_anomaly_suppress_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schemaName}` });
    await runMigrations(scopedPool);
    app = createApp(scopedPool, noopProvider);

    const { rows: clientRows } = await scopedPool.query(
      "INSERT INTO clients (name, contact_info) VALUES ($1, $2) RETURNING id",
      ["Spike Co", {}],
    );
    const clientId = clientRows[0].id as string;

    for (let i = 0; i < MONTHS.length; i++) {
      for (let day = 1; day <= COUNTS[i]; day++) {
        await scopedPool.query(
          `INSERT INTO sales_pipeline_audit (client_id, changed_by, from_stage, to_stage, changed_at)
           VALUES ($1, 'seed', 'prospecting', 'closed', $2)`,
          [clientId, `${MONTHS[i]}-${String(day).padStart(2, "0")}T00:00:00Z`],
        );
      }
    }
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("suppressing a flagged point widens the threshold and clears that point on the next GET", async () => {
    const before = await request(app).get("/api/analytics/anomalies").set("Authorization", salesAuthHeader());
    expect(before.status).toBe(200);
    expect(before.body.anomalies.status).toBe("ok");

    const spikeBefore = before.body.anomalies.points.find((p: { month: string }) => p.month === SPIKE_MONTH);
    expect(spikeBefore).toBeDefined();
    expect(spikeBefore.isAnomaly).toBe(true);
    expect(spikeBefore.baseline).toEqual(expect.any(Number));
    expect(before.body.anomalies.threshold.kStdDev).toBe(ANOMALY_CONFIG.baseKStdDev);

    const decide = await request(app)
      .post("/api/analytics/anomalies/decide")
      .set("Authorization", salesAuthHeader())
      .send({ month: SPIKE_MONTH, decision: "suppressed" });
    expect(decide.status).toBe(200);
    expect(decide.body.point.isAnomaly).toBe(false);
    const expectedKStdDev = ANOMALY_CONFIG.baseKStdDev + ANOMALY_CONFIG.suppressionStepStdDev;
    expect(decide.body.threshold.kStdDev).toBe(expectedKStdDev);

    // Re-read directly from Postgres — the persisted state, not just what
    // the HTTP response claims.
    const { rows: thresholdRows } = await scopedPool.query(
      "SELECT k_std_dev FROM anomaly_thresholds WHERE metric = $1",
      [ANOMALY_CONFIG.metric],
    );
    expect(Number(thresholdRows[0].k_std_dev)).toBe(expectedKStdDev);

    const { rows: auditRows } = await scopedPool.query(
      "SELECT step, detail FROM anomaly_audit WHERE metric = $1 AND month = $2",
      [ANOMALY_CONFIG.metric, SPIKE_MONTH],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].step).toBe("suppressed");
    expect(auditRows[0].detail.kStdDevBefore).toBe(ANOMALY_CONFIG.baseKStdDev);
    expect(auditRows[0].detail.kStdDevAfter).toBe(expectedKStdDev);

    // The whole trust scenario: the SAME point no longer fires on a fresh GET.
    const after = await request(app).get("/api/analytics/anomalies").set("Authorization", salesAuthHeader());
    expect(after.status).toBe(200);
    const spikeAfter = after.body.anomalies.points.find((p: { month: string }) => p.month === SPIKE_MONTH);
    expect(spikeAfter.isAnomaly).toBe(false);
    expect(spikeAfter.decision).toBe("suppressed");
    expect(after.body.anomalies.threshold.kStdDev).toBe(expectedKStdDev);
  });
});
