import { COMPANY_MATCH_CONFIG } from "./companyMatchConfig";

export type CompanyMatchBasis = "alias" | "fuzzy";

export interface CompanyMatchResult {
  score: number;
  basis: CompanyMatchBasis;
  matchedName: string;
}

// Same normalize-then-word-boundary technique classifyFamily()
// (hardToFillScore.ts) already uses: lowercase, collapse every run of
// non-alphanumeric characters to a single space, pad with boundary spaces.
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function stripLegalSuffixes(normalized: string): string {
  let result = normalized;
  for (const suffix of COMPANY_MATCH_CONFIG.legalSuffixStopwords) {
    result = result.replace(new RegExp(` ${suffix} `, "g"), " ");
  }
  return result.trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((token) => token.length > 0));
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * S-24 Decision A: pure, no DB/IO -- unit-testable like classifyFamily().
 * atsCompanyName is our own ATS-sourced company string (e.g. "GitLab");
 * filedName is one candidate real-world name a capacity source filed under
 * (e.g. "GITLAB B.V."). Caller picks the best-scoring filedName across every
 * raw_capacity_signals row for a given opportunity's company.
 *
 * Alias table checked first: a known, hand-confirmed real variant scores a
 * forced 1.0, basis "alias" -- Decision A's whole point (06_decisions/047)
 * is that a variant already confirmed real shouldn't have to keep surviving
 * fuzzy scoring. Otherwise, legal-suffix-stripped token-Jaccard, basis
 * "fuzzy". Never returns undefined -- callers apply Decision B's
 * high-confidence/low-confidence/drop thresholds against the returned score.
 */
export function matchCompany(atsCompanyName: string, filedName: string): CompanyMatchResult {
  const normalizedAts = stripLegalSuffixes(normalize(atsCompanyName));
  const normalizedFiled = stripLegalSuffixes(normalize(filedName));

  // Alias keys are the ATS name normalized but NOT suffix-stripped ("gitlab"
  // has no suffix to strip anyway); alias table values are compared against
  // the filed name's non-suffix-stripped form too, since the whole point of
  // an alias entry (e.g. "gitlab inc") is to record the real suffixed
  // string as filed.
  const aliasKey = normalize(atsCompanyName).trim();
  const knownAliases = COMPANY_MATCH_CONFIG.companyAliases[aliasKey] ?? [];
  const filedRawNormalized = normalize(filedName).trim();
  if (knownAliases.includes(filedRawNormalized)) {
    return { score: 1, basis: "alias", matchedName: filedName };
  }

  const score = tokenJaccard(tokenSet(normalizedAts), tokenSet(normalizedFiled));
  return { score, basis: "fuzzy", matchedName: filedName };
}
