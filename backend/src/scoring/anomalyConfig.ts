/**
 * PROPOSED — pending Ali's approval. See 06_decisions/025. The anomaly
 * detector's own constants — deliberately separate from FORECAST_CONFIG
 * (06_decisions/021), which S-13 owns and this story reuses UNMODIFIED for
 * the regression itself. Every constant revenueAnomaly.ts's route depends on
 * lives here, same discipline as confidenceConfig.ts/forecastConfig.ts.
 */
export const ANOMALY_CONFIG = {
  // Bumped by hand whenever a constant below actually changes — see
  // forecastConfig.ts's version field for why.
  version: "anomaly-025-v1",
  // "Revenue" has no real monetary column anywhere in this schema
  // (06_decisions/025) — placements-per-month (S-12/S-13's own series) is
  // reused as an explicit, named PROXY, not a redefinition of revenue as
  // real currency.
  metric: "placements_per_month",
  // Starting kStdDev for a metric with no anomaly_thresholds row yet — the
  // same 2-sigma constant FORECAST_CONFIG.outlierStdDevs uses, so a viewer
  // sees one consistent definition of "unusual" across both dashboard
  // sections before any human tuning has happened.
  baseKStdDev: 2,
  // The entire "learning" mechanism (06_decisions/025): suppressing a
  // flagged point widens that metric's kStdDev by this fixed, documented
  // step. Confirming an anomaly never changes it. There is deliberately no
  // narrowing or decay over time — flagged as an open scope question, not
  // silently built.
  suppressionStepStdDev: 0.5,
  // Hard ceiling so repeated suppression can never widen the band
  // unbounded.
  maxKStdDev: 4,
};
