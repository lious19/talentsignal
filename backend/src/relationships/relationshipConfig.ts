/**
 * PROPOSED — pending Ali's approval. See 06_decisions/018. Two-level
 * strength (not a precise float a human can't defend) and a flat
 * multiplicative penalty per hop beyond the first, same style as
 * MATCH_CONFIG's saturation cap (06_decisions/011).
 */
export const RELATIONSHIP_CONFIG = {
  strengthScore: {
    strong: 0.8,
    weak: 0.4,
  },
  additionalHopPenalty: 0.6,
};
