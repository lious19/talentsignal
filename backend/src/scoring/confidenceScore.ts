import type { MarketSignal } from "../adapters/marketSignalProvider";
import { CONFIDENCE_CONFIG } from "./confidenceConfig";

export interface ConfidenceResult {
  score: number;
  reasons: string[];
}

/**
 * Transparent weighted sum over CONFIDENCE_CONFIG — no factor here is
 * invented; every weight traces back to the PROPOSED config, pending Ali.
 * Returns the score alongside the plain-English reasons that produced it, so
 * a rendered opportunity never shows a bare number (S-03's trust scenario).
 */
export function scoreSignal(signal: MarketSignal): ConfidenceResult {
  const { baseScore, weights, daysOpenSaturationThreshold } = CONFIDENCE_CONFIG;
  const reasons: string[] = [];

  const daysOpenRatio = Math.min(signal.daysOpen, daysOpenSaturationThreshold) / daysOpenSaturationThreshold;
  reasons.push(`open ${signal.daysOpen} day${signal.daysOpen === 1 ? "" : "s"}`);

  let score = baseScore + weights.daysOpen * daysOpenRatio;

  if (signal.isRepost) {
    score += weights.repostedRole;
    reasons.push("reposted role");
  }

  if (!signal.hasSalaryRange) {
    score += weights.missingSalaryRange;
    reasons.push("no salary range");
  }

  return { score: Math.round(score * 1000) / 1000, reasons };
}
