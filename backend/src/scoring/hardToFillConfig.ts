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
  // S-23 bumped this to v2: weights and the [0,1] score range are unchanged,
  // but roleScarcity's VALUE now means something new (a measured ratio for
  // eligible Greenhouse families, not just a curated-list boolean), so every
  // stored score needs to be traceable to which meaning produced it. See
  // 06_decisions/046.
  // S-24 bumps this to v3: a new capacitySignal factor is added and the
  // other three weights are proportionally shrunk to make room for it
  // (roleScarcity 0.6->0.48, daysOpen/repostedRole 0.2->0.16 each) -- the
  // [0,1] range is still unchanged, but roleScarcity's own dominance within
  // the score is diluted, which is a real, visible change worth its own
  // version stamp. See 06_decisions/047. PROPOSED, pending Ali -- the
  // reweight is a proposal, not a fait accompli (06_decisions/047 states
  // this explicitly).
  version: "hard-to-fill-026-v3",

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
    // S-23: still the dominant factor -- this is the one genuinely new
    // difficulty signal S-23 added. S-24 note (PROPOSED, pending Ali,
    // 06_decisions/047): shrunk proportionally from 0.6 to 0.48 (x0.8) to
    // make room for capacitySignal below. This dilutes S-23's own
    // "dominant factor" framing -- flagged explicitly, not silently.
    roleScarcity: 0.48,
    // Reused from confidence as a difficulty reinforcer — corroborates
    // difficulty but isn't role-type evidence by itself. Shrunk from 0.2 to
    // 0.16 (x0.8), same S-24 reweight.
    daysOpen: 0.16,
    // Reused from confidence as the other reinforcer, weighted equally to
    // daysOpen — no basis to prefer one over the other for this score.
    // Shrunk from 0.2 to 0.16 (x0.8), same S-24 reweight.
    repostedRole: 0.16,
    // S-24: capacity evidence (H-1B LCA / federal awards / SEC Form D) --
    // does the employer show real, current external signal of hiring
    // capacity, independent of anything about the posting itself. New
    // weight, sized per the story's own suggestion; the other three shrink
    // proportionally to make room so the total still sums to 1.0.
    capacitySignal: 0.2,
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

  // A family needs at least this many Greenhouse observations before its
  // median daysOpen counts as "measured" evidence rather than opinion.
  // Lever is excluded from this count entirely (and from every median
  // computation) — see 06_decisions/046: Lever's real median daysOpen is
  // ~35x Greenhouse's, almost certainly because its raw `createdAt` field
  // doesn't mean what this scorer assumes "opened" means, not because
  // gopuff roles are genuinely that much harder to fill. Publishing a
  // "measured" claim built on that number would be exactly the invented
  // metric this story replaces roleScarcity's old opinion-based list to
  // avoid. Flagged for revisit once Lever's field semantics are confirmed
  // with a real client integration, not silently worked around.
  familyObservationThreshold: 10,

  // Allowlist, not a blocklist: a signal is only eligible for the measured
  // basis when its own source is in this list, regardless of how many
  // Greenhouse observations its family has elsewhere. This is deliberately
  // an allowlist so a future third source (or "seed-job-board", or a test
  // fixture's arbitrary source string) defaults to ineligible until someone
  // explicitly vets its daysOpen semantics the way decision 046 vetted (and
  // rejected) Lever's -- never silently "measured" just because it wasn't
  // named "lever".
  measuredEligibleSources: ["greenhouse"],

  // roleScarcity's measured value: min(1, familyMedianDaysOpen / (2 *
  // globalMedianDaysOpen)) -- saturates at 1.0 exactly when a family's
  // median sits at 2x the global median, matching the story's own "routinely
  // sit twice as long as the median" framing.
  measuredScarcitySaturationMultiple: 2,
};

// 0.48 + 0.16 + 0.16 + 0.2 = 1.0 — the score is always in [0, 1] by
// construction, no clamping required. Unlike CONFIDENCE_CONFIG, there is
// deliberately NO base score: a generic, fresh, non-reposted role with no
// capacity evidence must score exactly 0, per HF-1's "generic role scores
// low" acceptance criteria.

/**
 * S-24: capacity-signal-specific config, separate object from
 * HARD_TO_FILL_CONFIG (mirrors familyScarcity's own constants living beside,
 * not inside, HARD_TO_FILL_CONFIG) since these apply to a self-contained
 * sub-computation (matchCompany() + the recency gate), not the weighted-sum
 * shape the rest of HARD_TO_FILL_CONFIG follows. PROPOSED, pending Ali.
 * See 06_decisions/047 for the full reasoning behind every number here.
 */
export const CAPACITY_SIGNAL_CONFIG = {
  // Decision C: LCA is role-specific and legally binding -- the strongest
  // evidence of the three. Federal awards and Form D are company-level only
  // (no occupation data at all), so they're deliberately weaker multipliers
  // rather than full-strength factors of their own.
  sourceStrength: {
    "h1b-lca": 1,
    "federal-award": 0.6,
    "form-d": 0.5,
  } as Record<string, number>,

  // Decision B. >= this: "high-confidence", full contribution. An alias-
  // table hit (companyMatchConfig.ts) is always forced to 1.0, so it always
  // clears this regardless of where the line sits.
  highConfidenceThreshold: 0.85,

  // Decision B. Below this: dropped entirely -- no factor row at all, not
  // even a zero-contribution one. A match below 0.5 is more likely wrong
  // than right; showing it as if it were real evidence (even weak evidence)
  // would violate acceptance criterion 3 ("surfaced as low-confidence...
  // or dropped"), not honor it.
  dropBelowThreshold: 0.5,

  // Megan's instruction, verbatim: any capacity signal older than this
  // contributes 0 -- a decade-old contract award is not 2026 hiring intent.
  // A named constant, not a magic number, specifically so it's easy to find
  // and revisit; documented in 06_decisions/047's known-limits section.
  recencyMonths: 24,
};
