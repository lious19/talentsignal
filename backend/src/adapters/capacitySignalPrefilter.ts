// S-24: a cheap, shared prefilter all three capacity-signal providers use
// before deciding whether a raw row is even worth fetching detail for /
// persisting. This is NOT the real company match -- that's matchCompany()
// (backend/src/matching/companyMatch.ts), a pure function applied later at
// scoring time with the full token-Jaccard + alias-table logic. This is
// deliberately cheaper and looser (same technique Step 0's spot-check used:
// a case-insensitive substring check on the target's first significant
// word), because its only job is "is this row worth keeping at all," not
// "how confident is this match."
function normalizeForPrefilter(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function cheapNameMightMatch(candidateName: string, targetCompanyNames: string[]): boolean {
  const normalizedCandidate = normalizeForPrefilter(candidateName);
  return targetCompanyNames.some((target) => {
    const firstToken = normalizeForPrefilter(target).split(" ")[0];
    // Guard against a short/generic first token (e.g. "3", "co") producing
    // false-positive floods -- same floor Step 0's manual spot-check implicitly
    // used by only ever trying real, distinctive company names.
    return firstToken.length >= 3 && normalizedCandidate.includes(firstToken);
  });
}
