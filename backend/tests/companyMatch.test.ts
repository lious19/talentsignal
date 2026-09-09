import { describe, expect, it } from "vitest";
import { matchCompany } from "../src/matching/companyMatch";

// S-24 Decision A. Fixtures include the exact real strings Step 0's
// spot-check surfaced (05_presentations/S-24-exploration.md) -- not
// invented examples.
describe("matchCompany", () => {
  it("scores a hand-seeded alias as a forced 1.0, basis alias", () => {
    const result = matchCompany("GitLab", "GITLAB INC.");
    expect(result).toEqual({ score: 1, basis: "alias", matchedName: "GITLAB INC." });
  });

  it("scores the real GITLAB B.V. federal-award variant as an alias hit -- the exact case that proved naive token-Jaccard fails", () => {
    // Step 0's hand computation: without stripping "b v" as an
    // international legal suffix, {gitlab} vs {gitlab,b,v} is 1/3 = 0.33,
    // below Decision B's 0.5 drop line -- a real match would be silently
    // lost. The alias table (seeded from this exact Step 0 finding)
    // guarantees it's never lost.
    const result = matchCompany("GitLab", "GITLAB B.V.");
    expect(result.basis).toBe("alias");
    expect(result.score).toBe(1);
  });

  it("scores a non-aliased but suffix-only variant as a high fuzzy match", () => {
    // Not in the alias table, but stripping "Inc." still leaves an exact
    // token match -- proves the stopword list does real work even outside
    // the alias table, for companies never manually confirmed.
    const result = matchCompany("gopuff", "Gopuff Inc.");
    expect(result.basis).toBe("fuzzy");
    expect(result.score).toBe(1);
  });

  it("international multi-word suffixes (Group Holdings) are stripped the same way US ones are", () => {
    const result = matchCompany("gopuff", "Gopuff Group Holdings");
    expect(result.basis).toBe("fuzzy");
    expect(result.score).toBe(1);
  });

  it("scores a partial overlap (real subsidiary name) as a mid-range fuzzy match", () => {
    const result = matchCompany("GitLab", "GitLab Deutschland GmbH");
    expect(result.basis).toBe("fuzzy");
    // {gitlab} vs {gitlab, deutschland} (gmbh stripped) = 1/2
    expect(result.score).toBe(0.5);
  });

  it("scores an unrelated company near zero", () => {
    const result = matchCompany("GitLab", "Acme Widgets LLC");
    expect(result.score).toBe(0);
    expect(result.basis).toBe("fuzzy");
  });

  it("is case- and punctuation-insensitive", () => {
    const result = matchCompany("GitLab", "gitlab inc");
    expect(result.basis).toBe("alias");
    expect(result.score).toBe(1);
  });
});
