/**
 * PROPOSED — pending Ali's approval. See 06_decisions/007. Every weight and
 * threshold used by confidenceScore.ts lives in this one object so his
 * answer, whenever it lands, is a one-line edit here rather than a change
 * scattered across the scoring code.
 */
export const CONFIDENCE_CONFIG = {
  // Any confirmed posting starts here — a posting existing at all is
  // evidence a company is spending money to hire, never zero evidence.
  baseScore: 0.2,
  weights: {
    repostedRole: 0.32,
    daysOpen: 0.32,
    missingSalaryRange: 0.16,
  },
  // daysOpen's contribution ramps linearly up to this many days, then caps —
  // a role open 200 days shouldn't dominate the score more than one open 30.
  daysOpenSaturationThreshold: 30,
};

// 0.2 + 0.32 + 0.32 + 0.16 = 1.0 — the score is always in [0, 1] by
// construction, no clamping required.
