/**
 * PROPOSED — pending Ali's approval. See 06_decisions/026. Every keyword,
 * weight, and threshold used by hardToFillScore.ts lives in this one
 * object, mirroring confidenceConfig.ts's discipline (06_decisions/007):
 * Ali's answer, whenever it lands, is a one-line edit here rather than a
 * change scattered across the scoring code.
 */
export const HARD_TO_FILL_CONFIG = {
  // Bumped by hand whenever the keywords/weights/threshold below actually
  // change — see 06_decisions/012's versioning discipline, reused here for
  // a second, independent score. Every stored result stamps this value so
  // an old score stays traceable to the config that produced it even after
  // this string changes.
  version: "hard-to-fill-026-v1",

  // Case-insensitive substring match against MarketSignal.title. No
  // canonical role-type vocabulary exists in this schema (the same gap
  // decision 025 already flagged for segmentation) — this is a plain-text
  // heuristic list, not a taxonomy.
  roleKeywords: [
    "data analyst",
    "data scientist",
    "ai architect",
    "ai engineer",
    "ml engineer",
    "machine learning engineer",
    "data engineer",
    "cybersecurity",
    "security engineer",
    "cloud architect",
  ],

  weights: {
    // Dominant: this is the one genuinely new signal this story adds. If it
    // didn't dominate, a long-open reposted but otherwise generic role
    // could still cross into "hard to fill" on duration/repost alone.
    roleScarcity: 0.6,
    // Reused from confidence as a difficulty reinforcer — corroborates
    // difficulty but isn't role-type evidence by itself.
    daysOpen: 0.2,
    // Reused from confidence as the other reinforcer, weighted equally to
    // daysOpen — no basis to prefer one over the other for this score.
    repostedRole: 0.2,
  },

  // daysOpen's contribution ramps linearly up to this many days, then caps
  // — same shape as CONFIDENCE_CONFIG.daysOpenSaturationThreshold.
  daysOpenSaturationThreshold: 30,

  // Minimum score for a later story (HF-2) to actually flag/badge an
  // opportunity "hard to fill." Set above what the two reinforcers can
  // reach on their own (0.2 + 0.2 = 0.4), so crossing it mechanically
  // requires a genuine roleScarcity match, not just an old repost.
  hardToFillThreshold: 0.5,

  // S-23: title -> role-family keyword groups, checked before falling back
  // to roleKeywords above. Each key is a stable family_key (see migration
  // 018). Grounded in real title strings pulled from the live opportunities
  // table (05_presentations/S-23-exploration.md), not invented abstractly.
  // data-analytics and cloud-infra stay narrow on purpose: real Greenhouse
  // coverage is 3 and 6 rows respectively, and widening the keywords to
  // clear the observation threshold would mean sweeping in unrelated
  // management/director titles just to manufacture "measured" status —
  // the exact fabricated-metric failure mode this story exists to avoid.
  // Declaration order is a tie-breaker only within the same specificity
  // tier (see classifyFamily in hardToFillScore.ts): a multi-word keyword
  // in ANY family always wins over a single-word keyword in another, so
  // e.g. ml-ai's bare "ai" token can never preempt data-analytics' "data
  // engineer" phrase, regardless of which family is listed first here.
  roleFamilies: {
    "engineering-swe": ["software engineer", "backend engineer", "frontend engineer", "full stack", "fullstack"],
    "ml-ai": ["ai engineer", "ai architect", "machine learning", "ml engineer", "artificial intelligence", "ai"],
    "data-analytics": ["data analyst", "data scientist", "data engineer", "data science"],
    "security": ["security", "cybersecurity"],
    "cloud-infra": ["cloud architect", "cloud engineer", "infrastructure", "site reliability", "devops"],
    "support-cs": ["support engineer", "customer success", "help desk", "desktop support", "solutions architect"],
    "sales-bizdev": ["account executive", "business development", "sales"],
    "retail-ops": ["store associate", "key holder", "store manager", "operations associate", "forklift", "warehouse"],
  },
};

// 0.6 + 0.2 + 0.2 = 1.0 — the score is always in [0, 1] by construction, no
// clamping required. Unlike CONFIDENCE_CONFIG, there is deliberately NO base
// score: a generic, fresh, non-reposted role must score exactly 0, per
// HF-1's "generic role scores low" acceptance criteria.
