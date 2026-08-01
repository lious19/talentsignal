import { PACKAGE_CONFIG } from "./packageConfig";
import { scoreCandidate, type MatchCandidateInput, type MatchJobInput } from "../matching/matchScore";

export interface PackageOpportunityInput {
  company: string;
  confidenceScore: number;
  reasons: string[];
}

export interface PackageJobInput extends MatchJobInput {
  title: string;
}

export interface PackageCandidateInput extends MatchCandidateInput {
  id: string;
  name: string;
}

export interface ComposedPackageCandidate {
  id: string;
  name: string;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
}

export interface ComposedPackageContent {
  company: string;
  confidenceScore: number;
  opportunityReasons: string[];
  jobTitle: string;
  candidates: ComposedPackageCandidate[];
}

export interface ComposedPackage {
  candidateIds: string[];
  content: ComposedPackageContent;
}

// Same tiebreak convention as clientMatchmaking.ts's byFitScoreThenId and
// hiddenDemand.ts's byRankThenId — each route keeps its own local copy
// rather than sharing one util, consistent with how this codebase has
// already drawn that line.
function byFitScoreThenId(a: ComposedPackageCandidate, b: ComposedPackageCandidate): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Heuristic template composition, not an LLM call: reuses scoreCandidate()
 * from S-06 in-process (the exact cosine-style logic already ranks
 * candidates on the matchmaking screen) and picks the top
 * PACKAGE_CONFIG.topCandidateCount by fit score. Pure function — no I/O, no
 * randomness — so the same opportunity + job + candidate pool always
 * produces the same drafted content.
 */
export function composePackage(
  opportunity: PackageOpportunityInput,
  job: PackageJobInput,
  candidates: PackageCandidateInput[],
): ComposedPackage {
  const ranked = candidates
    .map((candidate) => {
      const result = scoreCandidate(candidate, job);
      return {
        id: candidate.id,
        name: candidate.name,
        fitScore: result.fitScore,
        matchedSkills: result.matchedSkills,
        reasons: result.reasons,
      };
    })
    .sort(byFitScoreThenId)
    .slice(0, PACKAGE_CONFIG.topCandidateCount);

  return {
    candidateIds: ranked.map((candidate) => candidate.id),
    content: {
      company: opportunity.company,
      confidenceScore: opportunity.confidenceScore,
      opportunityReasons: opportunity.reasons,
      jobTitle: job.title,
      candidates: ranked,
    },
  };
}
