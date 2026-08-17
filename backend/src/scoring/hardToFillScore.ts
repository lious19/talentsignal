import type { MarketSignal } from "../adapters/marketSignalProvider";
import { HARD_TO_FILL_CONFIG } from "./hardToFillConfig";

export interface HardToFillFactor {
  factor: "roleScarcity" | "daysOpen" | "repostedRole";
  weight: number;
  value: number;
  contribution: number;
}

export interface HardToFillResult {
  score: number;
  reasons: string[];
  factors: HardToFillFactor[];
  version: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type RawFactor = HardToFillFactor;

// Case-insensitive substring match — "Staff AI Architect (Remote)" matches
// "ai architect" the same way a title's exact wording elsewhere doesn't
// affect confidenceScore's daysOpen ratio. Punctuation-sensitive by design
// (an accepted heuristic-first tradeoff, see 06_decisions/026): "Sr.
// Data-Analyst" will NOT match "data analyst".
function matchesScarceRole(title: string): boolean {
  const normalized = title.toLowerCase();
  return HARD_TO_FILL_CONFIG.roleKeywords.some((keyword) => normalized.includes(keyword));
}

// The one place the arithmetic happens, in full float precision — no
// rounding yet. Same "round only at the boundary" convention
// confidenceScore.ts established.
function buildRawFactors(signal: MarketSignal): RawFactor[] {
  const { weights, daysOpenSaturationThreshold } = HARD_TO_FILL_CONFIG;
  const daysOpenRatio = Math.min(signal.daysOpen, daysOpenSaturationThreshold) / daysOpenSaturationThreshold;
  const isScarceRole = matchesScarceRole(signal.title);

  return [
    {
      factor: "roleScarcity",
      weight: weights.roleScarcity,
      value: isScarceRole ? 1 : 0,
      contribution: isScarceRole ? weights.roleScarcity : 0,
    },
    {
      factor: "daysOpen",
      weight: weights.daysOpen,
      value: daysOpenRatio,
      contribution: weights.daysOpen * daysOpenRatio,
    },
    {
      factor: "repostedRole",
      weight: weights.repostedRole,
      value: signal.isRepost ? 1 : 0,
      contribution: signal.isRepost ? weights.repostedRole : 0,
    },
  ];
}

// One row per configured factor, always in this fixed order, always
// present — even at value/contribution 0 — since a visible zero is more
// auditable than an omitted row, and it changes nothing about the score.
function toDisplayFactors(raw: RawFactor[]): HardToFillFactor[] {
  return raw.map((f) => ({
    factor: f.factor,
    weight: round3(f.weight),
    value: round3(f.value),
    contribution: round3(f.contribution),
  }));
}

// Reason strings are derived from the same factors array, not recomputed
// independently.
function factorsToReasons(signal: MarketSignal, factors: HardToFillFactor[]): string[] {
  const reasons: string[] = [];

  const roleScarcity = factors.find((f) => f.factor === "roleScarcity");
  if (roleScarcity && roleScarcity.contribution > 0) reasons.push("in-demand role type");

  reasons.push(`open ${signal.daysOpen} day${signal.daysOpen === 1 ? "" : "s"}`);

  const repostedRole = factors.find((f) => f.factor === "repostedRole");
  if (repostedRole && repostedRole.contribution > 0) reasons.push("reposted role");

  return reasons;
}

/**
 * Transparent weighted sum over HARD_TO_FILL_CONFIG — a separate,
 * explainable fill-difficulty score. Answers a different question than
 * confidenceScore.ts ("how hard is this role to fill" vs. "is this posting
 * real evidence of hiring demand"), so it stays its own function rather
 * than a fourth factor on scoreSignal() — the "one place per score"
 * discipline from S-07. No factor here is invented; every weight traces
 * back to the PROPOSED config, pending Ali.
 */
export function hardToFillScore(signal: MarketSignal): HardToFillResult {
  const raw = buildRawFactors(signal);
  const score = round3(raw.reduce((sum, f) => sum + f.contribution, 0));
  const factors = toDisplayFactors(raw);
  const reasons = factorsToReasons(signal, factors);

  return { score, reasons, factors, version: HARD_TO_FILL_CONFIG.version };
}
