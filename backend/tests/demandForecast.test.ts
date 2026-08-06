import { describe, expect, it } from "vitest";
import { computeForecast } from "../src/scoring/demandForecast";
import { FORECAST_CONFIG } from "../src/scoring/forecastConfig";

function series(months: string[], counts: number[]) {
  return months.map((month, i) => ({ month, count: counts[i] }));
}

const TWELVE_MONTHS = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
];

describe("computeForecast — happy path", () => {
  it("returns a predicted value and a band for each forecast month, from a trending history", () => {
    const counts = [3, 4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9];
    const result = computeForecast(series(TWELVE_MONTHS, counts));

    if (result.status !== "ok") throw new Error("expected status ok");
    expect(result.forecast).toHaveLength(FORECAST_CONFIG.horizonMonths);
    expect(result.historical).toHaveLength(12);
    for (const point of result.forecast) {
      expect(point.lowerBound).toBeLessThanOrEqual(point.predicted);
      expect(point.upperBound).toBeGreaterThanOrEqual(point.predicted);
    }
    // Upward trend in the source data should produce an upward-sloping forecast.
    expect(result.forecast[result.forecast.length - 1].predicted).toBeGreaterThan(
      result.forecast[0].predicted,
    );
  });

  it("labels forecast months sequentially past the end of history, wrapping the year", () => {
    const counts = [1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 6];
    const result = computeForecast(series(TWELVE_MONTHS, counts));

    if (result.status !== "ok") throw new Error("expected status ok");
    expect(result.forecast.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("the band comes from real residual spread, not a fixed width", () => {
    const perfectlyLinear = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
    const noisy = [2, 5, 4, 9, 8, 15, 12, 19, 16, 23, 20, 27];

    const flatResult = computeForecast(series(TWELVE_MONTHS, perfectlyLinear));
    const noisyResult = computeForecast(series(TWELVE_MONTHS, noisy));
    if (flatResult.status !== "ok" || noisyResult.status !== "ok") throw new Error("expected status ok");

    // A perfectly linear series has zero residual spread, so its band collapses
    // to the prediction itself.
    expect(flatResult.residualStd).toBe(0);
    expect(flatResult.forecast[0].upperBound - flatResult.forecast[0].lowerBound).toBe(0);

    // A noisier series with the same underlying trend must produce a wider band.
    const noisyBandWidth = noisyResult.forecast[0].upperBound - noisyResult.forecast[0].lowerBound;
    expect(noisyBandWidth).toBeGreaterThan(0);
  });
});

describe("computeForecast — trust scenario: outliers are flagged, not smoothed", () => {
  const months = TWELVE_MONTHS.slice(0, 10);
  const trending = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7];
  const withSpike = [...trending];
  withSpike[4] = 15; // deliberate one-off spike in an otherwise mild trend

  it("flags the spike as an outlier and preserves its true value unchanged", () => {
    const result = computeForecast(series(months, withSpike));
    if (result.status !== "ok") throw new Error("expected status ok");

    const spikePoint = result.historical[4];
    expect(spikePoint.count).toBe(15);
    expect(spikePoint.isOutlier).toBe(true);
  });

  it("does not flag ordinary trending months as outliers", () => {
    const result = computeForecast(series(months, withSpike));
    if (result.status !== "ok") throw new Error("expected status ok");

    const nonSpikeFlags = result.historical.filter((_, i) => i !== 4).map((p) => p.isOutlier);
    expect(nonSpikeFlags).toEqual(nonSpikeFlags.map(() => false));
  });

  it("widens the confidence band relative to the same series without the spike", () => {
    const withSpikeResult = computeForecast(series(months, withSpike));
    const withoutSpikeResult = computeForecast(series(months, trending));
    if (withSpikeResult.status !== "ok" || withoutSpikeResult.status !== "ok") {
      throw new Error("expected status ok");
    }

    const spikeBandWidth =
      withSpikeResult.forecast[0].upperBound - withSpikeResult.forecast[0].lowerBound;
    const cleanBandWidth =
      withoutSpikeResult.forecast[0].upperBound - withoutSpikeResult.forecast[0].lowerBound;

    // This is the honest, checkable consequence of keeping the outlier in the
    // fit (06_decisions/021): it does not get excluded or smoothed away, so
    // its extra variance shows up as a wider — less confident — band. There
    // is deliberately no assertion here that the trend slope "ignores" the
    // spike; by construction, an OLS fit that includes a point cannot ignore it.
    expect(spikeBandWidth).toBeGreaterThan(cleanBandWidth);
  });
});

describe("computeForecast — short and empty history", () => {
  it("returns insufficient-history, not a crash, for an empty series", () => {
    const result = computeForecast([]);
    expect(result).toEqual({
      status: "insufficient-history",
      monthsAvailable: 0,
      monthsRequired: FORECAST_CONFIG.minHistoryMonths,
    });
  });

  it("returns insufficient-history for a single-month series", () => {
    const result = computeForecast(series(["2026-01"], [5]));
    expect(result.status).toBe("insufficient-history");
    if (result.status !== "insufficient-history") throw new Error("expected insufficient-history");
    expect(result.monthsAvailable).toBe(1);
  });

  it("returns insufficient-history below the configured minimum, ok at and above it", () => {
    const twoMonths = computeForecast(series(["2026-01", "2026-02"], [5, 6]));
    expect(twoMonths.status).toBe("insufficient-history");

    const threeMonths = computeForecast(series(["2026-01", "2026-02", "2026-03"], [5, 6, 7]));
    expect(threeMonths.status).toBe("ok");
  });
});
