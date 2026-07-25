import { MATCH_CONFIG } from "./matchConfig";

export interface MatchCandidateInput {
  skills: string[];
  experience: number | null;
}

export interface MatchJobInput {
  requirements: string[];
}

export interface MatchResult {
  fitScore: number;
  skillsScore: number;
  experienceScore: number;
  skillsContribution: number;
  experienceContribution: number;
  // NOT a "which factor is bigger" contest — under MATCH_CONFIG's weights,
  // skills structurally contributes at least ~2.3x experience whenever
  // skillsScore > 0 (see matchConfig.ts), so experience can never
  // "outweigh" skills. This instead answers "did experience add anything
  // on top of the skill match": "no-skill-match" when there's no overlap at
  // all (fitScore is 0 regardless of experience), "skills-only" when there
  // is overlap but the candidate has no experience to credit, and
  // "skills-plus-experience" when both contributed.
  rankDriver: "no-skill-match" | "skills-only" | "skills-plus-experience";
  matchedSkills: string[];
  reasons: string[];
}

// Exact-string matching after case/whitespace normalization only — "JS" will
// not match "JavaScript". A known limitation of this first pass, not a
// silent gap: fuzzy/semantic skill matching is out of scope for the cosine
// method Ali prescribed.
function normalize(term: string): string {
  return term.trim().toLowerCase();
}

function toNormalizedSet(terms: string[]): Set<string> {
  return new Set(terms.map(normalize).filter((term) => term.length > 0));
}

function determineRankDriver(
  skillsScore: number,
  experienceScore: number,
): MatchResult["rankDriver"] {
  if (skillsScore === 0) return "no-skill-match";
  return experienceScore > 0 ? "skills-plus-experience" : "skills-only";
}

/**
 * Cosine-style similarity on skills overlap (Ali's prescribed method),
 * combined with a normalized, saturating experience factor per
 * MATCH_CONFIG. Pure function: no I/O, no randomness, so the same
 * candidate + job always produce the same result (the idempotency AC).
 *
 * The cosine formula for two 0/1 (binary) vectors — a skill is either
 * present or absent — collapses to intersection size over the geometric
 * mean of the two set sizes (the Ochiai coefficient):
 *   cosine(A, B) = (A . B) / (|A| * |B|) = |A intersect B| / sqrt(|A| * |B|)
 * because the dot product of two 0/1 vectors is just the count of shared
 * terms, and the magnitude of a 0/1 vector is sqrt(its own popcount). There
 * is no need to materialize an actual vector over some skills vocabulary.
 */
export function scoreCandidate(candidate: MatchCandidateInput, job: MatchJobInput): MatchResult {
  const { weights, experienceSaturationYears } = MATCH_CONFIG;
  const reasons: string[] = [];

  const candidateSkills = toNormalizedSet(candidate.skills);
  const requirements = toNormalizedSet(job.requirements);

  const originalCasing = new Map<string, string>();
  for (const skill of candidate.skills) {
    const key = normalize(skill);
    if (key.length > 0 && !originalCasing.has(key)) originalCasing.set(key, skill);
  }

  const matchedKeys = [...candidateSkills].filter((skill) => requirements.has(skill));
  const matchedSkills = matchedKeys.map((key) => originalCasing.get(key) ?? key);

  let skillsScore: number;
  if (candidateSkills.size === 0 || requirements.size === 0) {
    skillsScore = 0;
    reasons.push(
      candidateSkills.size === 0 ? "candidate has no listed skills" : "job has no listed requirements",
    );
  } else {
    skillsScore = matchedKeys.length / Math.sqrt(candidateSkills.size * requirements.size);
    reasons.push(
      matchedKeys.length > 0
        ? `matched ${matchedSkills.join(", ")} (${matchedKeys.length} of ${requirements.size} requirements)`
        : "no matching skills",
    );
  }

  const experienceYears = candidate.experience ?? 0;
  const experienceScore = Math.min(experienceYears, experienceSaturationYears) / experienceSaturationYears;
  reasons.push(`${experienceYears} year${experienceYears === 1 ? "" : "s"} experience`);

  const skillsContribution = skillsScore * weights.skills;
  const experienceContribution = skillsScore * weights.experience * experienceScore;
  const fitScore = skillsContribution + experienceContribution;

  const rankDriver = determineRankDriver(skillsScore, experienceScore);
  if (rankDriver === "skills-plus-experience") reasons.push("experience added to this rank");

  return {
    fitScore: Math.round(fitScore * 1000) / 1000,
    skillsScore: Math.round(skillsScore * 1000) / 1000,
    experienceScore: Math.round(experienceScore * 1000) / 1000,
    skillsContribution: Math.round(skillsContribution * 1000) / 1000,
    experienceContribution: Math.round(experienceContribution * 1000) / 1000,
    rankDriver,
    matchedSkills,
    reasons,
  };
}
