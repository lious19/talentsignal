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

// Lowercases and collapses every run of non-alphanumeric characters (including
// punctuation like ".", "-", "/") down to a single space, so "Sr. Data-Analyst"
// and "Data/Analyst" both normalize to the same token stream as "Data Analyst".
// Padded with a leading/trailing space so a keyword search can require word
// boundaries via simple substring matching against " keyword " rather than a
// regex per keyword.
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

// Word-boundary substring match — fixes the punctuation-sensitivity gap
// decision 026 flagged ("Sr. Data-Analyst" now matches "data analyst") while
// keeping the original phrase-based matching semantics: multi-word keywords
// still require the whole phrase, in order, as a run of tokens.
function matchesAnyKeyword(title: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(title);
  return keywords.some((keyword) => normalized.includes(` ${normalizeForMatch(keyword).trim()} `));
}

function matchesScarceRole(title: string): boolean {
  return matchesAnyKeyword(title, HARD_TO_FILL_CONFIG.roleKeywords);
}

// S-23: classifies a free-text title into a role family for measured
// roleScarcity (see familyScarcity.ts, Step 3). Falls back to
// "general-other" when nothing matches — this is the expected outcome for a
// real, large slice of the dataset (e.g. leadership/management titles, see
// 06_decisions/046's "known gaps" section), not an error case.
//
// Precedence rule: a multi-word (specific) keyword match always wins over a
// single-word (broad) keyword match, regardless of family order — checked in
// two passes below. Only when nothing specific matches anywhere does a broad
// token (roleFamilies' single-word entries, e.g. ml-ai's "ai", security's
// "security") get to decide, in roleFamilies' declaration order. This
// matters concretely: ml-ai's bare "ai" token would otherwise preempt
// data-analytics' "data engineer" on a title like "AI Data Engineer" simply
// because ml-ai is declared first — the two-pass split fixes that instead of
// leaving it to accidental object order. Pinned by
// classifyFamily.test.ts's precedence cases.
export function classifyFamily(title: string): string {
  const entries = Object.entries(HARD_TO_FILL_CONFIG.roleFamilies);
  const isSpecific = (keyword: string) => keyword.trim().includes(" ");

  for (const [familyKey, keywords] of entries) {
    if (matchesAnyKeyword(title, keywords.filter(isSpecific))) return familyKey;
  }
  for (const [familyKey, keywords] of entries) {
    if (matchesAnyKeyword(title, keywords.filter((k) => !isSpecific(k)))) return familyKey;
  }
  return "general-other";
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
