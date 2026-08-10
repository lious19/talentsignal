import { computeForecast, type HistoricalPoint } from "./demandForecast";

export interface AnomalyPoint {
  month: string;
  count: number;
  baseline: number;
  lowerBound: number;
  upperBound: number;
  residual: number;
  isAnomaly: boolean;
}

export type AnomalyClassification =
  | { status: "ok"; residualStd: number; points: AnomalyPoint[] }
  | { status: "insufficient-history"; monthsAvailable: number; monthsRequired: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The whole ScoringAgent boundary for S-17's anomaly detector: one pure
 * function, no I/O, mirroring computeForecast()/scoreCandidate()'s shape.
 *
 * Reuses computeForecast() (S-13, demandForecast.ts) COMPLETELY UNMODIFIED
 * for the regression/residual math — the trend line, each point's residual,
 * and residualStd are exactly what S-13 already computes and the forecast
 * chart already shows (06_decisions/025). The one thing this function does
 * NOT reuse is computeForecast()'s own isOutlier flag, which is permanently
 * tied to FORECAST_CONFIG.outlierStdDevs (a fixed constant S-13 owns) —
 * instead this re-classifies every historical point against kStdDev, S-17's
 * OWN, separately mutable threshold. Suppressing a false positive here can
 * therefore never change what S-13's forecast chart calls an outlier, and
 * vice versa; the two features share math but not tuning state.
 */
export function classifyAnomalies(
  series: { month: string; count: number }[],
  kStdDev: number,
): AnomalyClassification {
  const result = computeForecast(series);
  if (result.status === "insufficient-history") {
    return result;
  }

  const bandOffset = kStdDev * result.residualStd;
  const points: AnomalyPoint[] = result.historical.map((point: HistoricalPoint) => ({
    month: point.month,
    count: point.count,
    baseline: point.fitted,
    lowerBound: round2(point.fitted - bandOffset),
    upperBound: round2(point.fitted + bandOffset),
    residual: point.residual,
    isAnomaly: Math.abs(point.residual) > bandOffset,
  }));

  return { status: "ok", residualStd: result.residualStd, points };
}
