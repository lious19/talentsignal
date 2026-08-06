/**
 * PROPOSED — pending Ali's approval. See 06_decisions/021. Every constant
 * demandForecast.ts depends on lives in this one object, same discipline as
 * confidenceConfig.ts — his answer, whenever it lands, is a one-line edit
 * here rather than a change scattered across the forecasting code.
 */
export const FORECAST_CONFIG = {
  // Bumped by hand whenever a constant below actually changes, so a stored
  // or logged forecast stays traceable to the config that produced it —
  // same convention confidenceConfig.ts's `version` field established.
  version: "forecast-021-v1",
  // Simple OLS trend line, not moving average or exponential smoothing —
  // see 06_decisions/021 for why a flat-continuation method was rejected.
  method: "linear-trend" as const,
  // How many months ahead the forecast extends.
  horizonMonths: 3,
  // predicted ± bandWidthStdDevs * residualStd — see 06_decisions/021 for
  // the full formula and why this is a constant-width band, not a
  // distance-widening prediction interval.
  bandWidthStdDevs: 2,
  // Deliberately the same constant as bandWidthStdDevs — a historical point
  // is an outlier when its residual exceeds this many std devs from trend.
  outlierStdDevs: 2,
  // Fewer months of history than this and there aren't enough degrees of
  // freedom (n - 2) for a meaningful residual std dev — the route returns a
  // graceful "insufficient history" result instead of forecasting.
  minHistoryMonths: 3,
};
