/**
 * PROPOSED — pending Ali's approval. See 06_decisions/011. Ali prescribed the
 * METHOD (cosine-style similarity on skills overlap — see matchScore.ts,
 * not this file); everything here is only what he left open: how a skills
 * match combines with experience into one fit score, and how much
 * experience "saturates."
 */
export const MATCH_CONFIG = {
  weights: {
    skills: 0.7,
    experience: 0.3,
  },
  experienceSaturationYears: 10,
};

// weights.skills + weights.experience = 1.0, and skillsScore/experienceScore
// are each in [0, 1] by construction, so fitScore stays in [0, 1].
//
// Combined MULTIPLICATIVELY, not additively:
//   fitScore = skillsScore * (weights.skills + weights.experience * experienceScore)
// A pure additive blend (skillsScore*weights.skills + experienceScore*weights.experience)
// lets a candidate with ZERO matching skills but high experience outrank one
// with a real (if weak) skill match — the wrong ranking for a skills-first
// tool. Multiplying by skillsScore guarantees skillsScore = 0 forces
// fitScore = 0, so experience can only ever act as a bonus on top of an
// actual skills match, never a substitute for having none. See
// 06_decisions/011 for the additive/hard-gate alternatives this ruled out.
//
// A direct consequence, worth naming explicitly: with these weights,
// experienceContribution can never exceed skillsContribution * (0.3/0.7) ~=
// 0.43x, for ANY candidate with a nonzero skill match — skills always
// contributes at least as much as experience to a nonzero score, by
// construction. So a rank is never "driven by experience" in the sense of
// experience outweighing skills; experience only ever adds a bounded boost
// on top of a real skill match, or contributes nothing (see matchScore.ts's
// rankDriver, which reflects this honestly rather than implying a contest
// experience can't structurally win).
