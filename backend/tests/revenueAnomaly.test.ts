import { describe, expect, it } from "vitest";
import { classifyAnomalies } from "../src/scoring/revenueAnomaly";

function series(months: string[], counts: number[]) {
  return months.map((month, i) => ({ month, count: counts[i] }));
}

const TWELVE_MONTHS = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
];

describe("classifyAnomalies — fires on a real breach and reports its baseline", () => {
  const months = TWELVE_MONTHS.slice(0, 10);
  const trending = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7];
  const withSpike = [...trending];
  withSpike[4] = 15; // deliberate one-off spike in an otherwise mild trend

  it("flags the spike and attaches its baseline for context, not a bare boolean", () => {
    const result = classifyAnomalies(series(months, withSpike), 2);
    if (result.status !== "ok") throw new Error("expected status ok");

    const spikePoint = result.points[4];
    expect(spikePoint.count).toBe(15);
    expect(spikePoint.isAnomaly).toBe(true);
    // S-17's own Gherkin: "an anomaly is flagged with its baseline for
    // context" — never just a bare true/false.
    expect(spikePoint.baseline).toEqual(expect.any(Number));
    expect(spikePoint.lowerBound).toBeLessThanOrEqual(spikePoint.baseline);
    expect(spikePoint.upperBound).toBeGreaterThanOrEqual(spikePoint.baseline);
  });

  it("does not flag ordinary trending months as anomalies", () => {
    const result = classifyAnomalies(series(months, withSpike), 2);
    if (result.status !== "ok") throw new Error("expected status ok");

    const nonSpikeFlags = result.points.filter((_, i) => i !== 4).map((p) => p.isAnomaly);
    expect(nonSpikeFlags).toEqual(nonSpikeFlags.map(() => false));
  });

  it("trust scenario: widening kStdDev makes the exact same point stop firing", () => {
    const narrow = classifyAnomalies(series(months, withSpike), 2);
    const wide = classifyAnomalies(series(months, withSpike), 4);
    if (narrow.status !== "ok" || wide.status !== "ok") throw new Error("expected status ok");

    expect(narrow.points[4].isAnomaly).toBe(true);
    expect(wide.points[4].isAnomaly).toBe(false);
    // Everything else about the point (count, baseline) is unchanged by
    // re-thresholding — only isAnomaly and the band move.
    expect(wide.points[4].count).toBe(narrow.points[4].count);
    expect(wide.points[4].baseline).toBe(narrow.points[4].baseline);
  });

  it("reuses computeForecast()'s own residual spread — does not fork S-13's regression", () => {
    const a = classifyAnomalies(series(months, withSpike), 2);
    const b = classifyAnomalies(series(months, withSpike), 3);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("expected status ok");
    // residualStd depends only on the trend fit, never on kStdDev — the same
    // number regardless of which threshold classifyAnomalies is asked to
    // classify against.
    expect(a.residualStd).toBe(b.residualStd);
  });
});

describe("classifyAnomalies — short and empty history", () => {
  it("returns insufficient-history, not a crash, for an empty series", () => {
    const result = classifyAnomalies([], 2);
    expect(result.status).toBe("insufficient-history");
  });

  it("returns insufficient-history below the configured minimum, ok at and above it", () => {
    const twoMonths = classifyAnomalies(series(["2026-01", "2026-02"], [5, 6]), 2);
    expect(twoMonths.status).toBe("insufficient-history");

    const threeMonths = classifyAnomalies(series(["2026-01", "2026-02", "2026-03"], [5, 6, 7]), 2);
    expect(threeMonths.status).toBe("ok");
  });
});
