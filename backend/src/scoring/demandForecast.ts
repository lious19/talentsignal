import { FORECAST_CONFIG } from "./forecastConfig";

export interface HistoricalPoint {
  month: string;
  count: number;
  fitted: number;
  residual: number;
  isOutlier: boolean;
}

export interface ForecastPoint {
  month: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
}

export type DemandForecastResult =
  | {
      status: "ok";
      method: string;
      version: string;
      residualStd: number;
      historical: HistoricalPoint[];
      forecast: ForecastPoint[];
    }
  | {
      status: "insufficient-history";
      monthsAvailable: number;
      monthsRequired: number;
    };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// x is the ordinal position of a month WITHIN the provided series (0, 1, 2,
// ...), not a calendar-continuous timeline. The series only contains months
// that had at least one closing (same as analytics.ts's GROUP BY) — a
// zero-closing month simply produces no row, so it's not a gap in the fit,
// it's an absent point. Keeping x purely ordinal is the simplification that
// lets this stay a two-line regression instead of a calendar-aware one.
function fitLinearTrend(counts: number[]): { slope: number; intercept: number } {
  const n = counts.length;
  const xMean = (n - 1) / 2;
  const yMean = counts.reduce((sum, y) => sum + y, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let x = 0; x < n; x++) {
    numerator += (x - xMean) * (counts[x] - yMean);
    denominator += (x - xMean) ** 2;
  }

  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

// n - 2, not n - 1: the trend line already spent two degrees of freedom
// fitting slope and intercept before these residuals were measured. Only
// called with n >= FORECAST_CONFIG.minHistoryMonths (3), so n - 2 >= 1.
function computeResidualStd(residuals: number[]): number {
  const n = residuals.length;
  const sumSquares = residuals.reduce((sum, r) => sum + r * r, 0);
  return Math.sqrt(sumSquares / (n - 2));
}

// "YYYY-MM" + N months, wrapping year boundaries — used only to label
// forecast points past the end of the historical series.
function addMonths(monthLabel: string, offset: number): string {
  const [year, month] = monthLabel.split("-").map(Number);
  const zeroBasedMonth = month - 1 + offset;
  const targetYear = year + Math.floor(zeroBasedMonth / 12);
  const targetMonth = ((zeroBasedMonth % 12) + 12) % 12;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
}

/**
 * The whole ScoringAgent boundary for S-13: one pure function, no I/O,
 * mirroring confidenceScore.ts's scoreSignal() shape. Fits one OLS trend
 * line over the full historical series (outliers included, never excluded —
 * see 06_decisions/021 for why), then reuses the same residual spread for
 * both the forecast's confidence band and the historical outlier flags.
 *
 * `series` must be chronologically ordered; every constant this function
 * depends on lives in FORECAST_CONFIG (PROPOSED, 06_decisions/021), never
 * inlined here.
 */
export function computeForecast(series: { month: string; count: number }[]): DemandForecastResult {
  const n = series.length;
  if (n < FORECAST_CONFIG.minHistoryMonths) {
    return {
      status: "insufficient-history",
      monthsAvailable: n,
      monthsRequired: FORECAST_CONFIG.minHistoryMonths,
    };
  }

  const counts = series.map((point) => point.count);
  const { slope, intercept } = fitLinearTrend(counts);

  const fittedValues = counts.map((_, x) => slope * x + intercept);
  const residuals = counts.map((actual, x) => actual - fittedValues[x]);
  const residualStd = computeResidualStd(residuals);
  const outlierCutoff = FORECAST_CONFIG.outlierStdDevs * residualStd;

  const historical: HistoricalPoint[] = series.map((point, x) => ({
    month: point.month,
    count: point.count,
    fitted: round2(fittedValues[x]),
    residual: round2(residuals[x]),
    isOutlier: Math.abs(residuals[x]) > outlierCutoff,
  }));

  const bandOffset = FORECAST_CONFIG.bandWidthStdDevs * residualStd;
  const forecast: ForecastPoint[] = [];
  for (let step = 1; step <= FORECAST_CONFIG.horizonMonths; step++) {
    const x = n - 1 + step;
    const predicted = slope * x + intercept;
    forecast.push({
      month: addMonths(series[n - 1].month, step),
      predicted: round2(predicted),
      lowerBound: round2(predicted - bandOffset),
      upperBound: round2(predicted + bandOffset),
    });
  }

  return {
    status: "ok",
    method: FORECAST_CONFIG.method,
    version: FORECAST_CONFIG.version,
    residualStd: round2(residualStd),
    historical,
    forecast,
  };
}
