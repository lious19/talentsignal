import { HARD_TO_FILL_CONFIG } from "../scoring/hardToFillConfig";

/**
 * PROPOSED — pending Ali (see 06_decisions/027). HF-3 ranks students against a
 * hard-to-fill role, but a market-signal opportunity stores only a title, not
 * required skills — and decision 015 deliberately refused to invent an
 * opportunity->job_opening link. This map is the transparent, swappable bridge
 * instead: each hard-to-fill role TYPE (the SAME keyword list HF-1 scores on,
 * imported here so there is one source of truth, never duplicated) maps to a
 * representative set of required skills, so scoreCandidate() has something real
 * to match on. Exactly the heuristic-first, Ali-gated pattern of
 * HARD_TO_FILL_CONFIG (026): confirming or editing a role's skills is a
 * one-line change here, touching nothing else.
 */
export const ROLE_SKILLS: Record<string, string[]> = {
  "data analyst": ["sql", "python", "data visualization", "statistics", "excel"],
  "data scientist": ["python", "machine learning", "statistics", "sql", "pandas"],
  "ai architect": ["machine learning", "cloud", "mlops", "python", "system design"],
  "ai engineer": ["python", "machine learning", "deep learning", "apis", "mlops"],
  "ml engineer": ["python", "pytorch", "machine learning", "data pipelines", "mlops"],
  "machine learning engineer": ["python", "pytorch", "machine learning", "data pipelines", "mlops"],
  "data engineer": ["sql", "python", "etl", "spark", "data pipelines"],
  "cybersecurity": ["network security", "siem", "incident response", "python", "risk assessment"],
  "security engineer": ["application security", "cloud security", "python", "threat modeling", "siem"],
  "cloud architect": ["aws", "azure", "terraform", "kubernetes", "system design"],
};

export interface RoleRequirements {
  // The hard-to-fill role keyword the title matched (e.g. "data analyst"), or
  // null if the title matches no known scarce role — in which case there are
  // no requirements to match on and the opportunity simply isn't a targeting
  // candidate.
  roleType: string | null;
  requirements: string[];
}

/**
 * Maps a role title to its representative required skills by finding which
 * hard-to-fill keyword the title contains — reusing HARD_TO_FILL_CONFIG's
 * roleKeywords (and its case-insensitive, punctuation-sensitive substring
 * semantics) so the role a title resolves to HERE is the exact same role HF-1
 * flagged it under. First keyword wins, in config order.
 */
export function requirementsForTitle(title: string): RoleRequirements {
  const normalized = title.toLowerCase();
  for (const keyword of HARD_TO_FILL_CONFIG.roleKeywords) {
    if (normalized.includes(keyword)) {
      return { roleType: keyword, requirements: ROLE_SKILLS[keyword] ?? [] };
    }
  }
  return { roleType: null, requirements: [] };
}
