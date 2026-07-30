import type { MarketSignal } from "../adapters/marketSignalProvider";
import { CONFIDENCE_CONFIG } from "./confidenceConfig";

export interface ScoreFactor {
  factor: "baseScore" | "daysOpen" | "repostedRole" | "missingSalaryRange";
  weight: number;
  value: number;
  contribution: number;
}

export interface ConfidenceResult {
  score: number;
  reasons: string[];
  factors: ScoreFactor[];
  weightsVersion: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type RawFactor = { factor: ScoreFactor["factor"]; weight: number; value: number; contribution: number };

// The one place the arithmetic happens, in full float precision — no
// rounding yet. scoreSignal() sums these UNROUNDED contributions for
// `score` (so the total matches, to full precision, what the pre-S-07
// scoreSignal computed) and separately rounds each field for display in the
// public `factors` breakdown — the same "round only at the boundary"
// convention matchScore.ts already uses for its own contribution fields.
function buildRawFactors(signal: MarketSignal): RawFactor[] {
  const { baseScore, weights, daysOpenSaturationThreshold } = CONFIDENCE_CONFIG;
  const daysOpenRatio = Math.min(signal.daysOpen, daysOpenSaturationThreshold) / daysOpenSaturationThreshold;

  return [
    { factor: "baseScore", weight: baseScore, value: 1, contribution: baseScore },
    { factor: "daysOpen", weight: weights.daysOpen, value: daysOpenRatio, contribution: weights.daysOpen * daysOpenRatio },
    {
      factor: "repostedRole",
      weight: weights.repostedRole,
      value: signal.isRepost ? 1 : 0,
      contribution: signal.isRepost ? weights.repostedRole : 0,
    },
    {
      factor: "missingSalaryRange",
      weight: weights.missingSalaryRange,
      value: signal.hasSalaryRange ? 0 : 1,
      contribution: signal.hasSalaryRange ? 0 : weights.missingSalaryRange,
    },
  ];
}

// S-07's structured breakdown: one row per configured factor, always in this
// fixed order, always present — even at value/contribution 0 (e.g.
// repostedRole on a non-repost) — since a visible zero is more auditable
// than an omitted row, and it changes nothing about the score.
function toDisplayFactors(raw: RawFactor[]): ScoreFactor[] {
  return raw.map((f) => ({
    factor: f.factor,
    weight: round3(f.weight),
    value: round3(f.value),
    contribution: round3(f.contribution),
  }));
}

// Reason strings are derived from the same factors array, not recomputed
// independently — exact current wording/order preserved so existing callers
// and tests that inspect `reasons` see no behavior change from this refactor.
function factorsToReasons(signal: MarketSignal, factors: ScoreFactor[]): string[] {
  const reasons: string[] = [`open ${signal.daysOpen} day${signal.daysOpen === 1 ? "" : "s"}`];

  const repostedRole = factors.find((f) => f.factor === "repostedRole");
  if (repostedRole && repostedRole.contribution > 0) reasons.push("reposted role");

  const missingSalaryRange = factors.find((f) => f.factor === "missingSalaryRange");
  if (missingSalaryRange && missingSalaryRange.contribution > 0) reasons.push("no salary range");

  return reasons;
}

/**
 * Transparent weighted sum over CONFIDENCE_CONFIG — no factor here is
 * invented; every weight traces back to the PROPOSED config, pending Ali.
 * Returns the score alongside the plain-English reasons that produced it, so
 * a rendered opportunity never shows a bare number (S-03's trust scenario),
 * plus the structured factor breakdown and weights version S-07 adds on top
 * (06_decisions/012) — same arithmetic, just exposed with more structure.
 */
export function scoreSignal(signal: MarketSignal): ConfidenceResult {
  const raw = buildRawFactors(signal);
  const score = round3(raw.reduce((sum, f) => sum + f.contribution, 0));
  const factors = toDisplayFactors(raw);
  const reasons = factorsToReasons(signal, factors);

  return { score, reasons, factors, weightsVersion: CONFIDENCE_CONFIG.version };
}
