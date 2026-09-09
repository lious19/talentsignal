/**
 * S-24: company-name matching config for capacity signals. PROPOSED,
 * pending Ali -- same posture as every other config object in this
 * codebase (confidenceConfig.ts, hardToFillConfig.ts).
 */
export const COMPANY_MATCH_CONFIG = {
  // International legal-entity suffixes, stripped before token-Jaccard.
  // Megan's list verbatim, plus the international ones Step 0's real data
  // proved necessary: naive Jaccard on "GitLab" vs "GITLAB B.V." (a real
  // federal-award recipient name) scores 0.33 -- below the 0.5 drop line --
  // unless "b v" is stripped as a legal suffix the same way "inc" is.
  // Multi-word suffixes ("b v", "n v") are matched as a token sequence
  // after normalization collapses punctuation to spaces.
  legalSuffixStopwords: [
    "inc",
    "llc",
    "ltd",
    "gmbh",
    "b v",
    "n v",
    "sa",
    "ag",
    "corp",
    "corporation",
    "group",
    "holdings",
  ],
  // Hand-seeded, real variants Step 0 actually found filed under GitLab's
  // name in federal award data -- not guessed. Keyed by normalized ATS
  // company name; each value is a normalized real filed-name variant. An
  // alias hit is basis "alias", forced to score 1.0 (06_decisions/047):
  // Decision A's whole point is that a known real variant shouldn't have to
  // survive fuzzy scoring on every run once it's been seen and confirmed.
  companyAliases: {
    gitlab: ["gitlab inc", "gitlab b v"],
  } as Record<string, string[]>,
};
