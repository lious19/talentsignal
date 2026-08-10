/**
 * PROPOSED — pending Ali's approval. See 06_decisions/025. S-17 asks for
 * clients grouped "by need" — proxied here as open hiring volume (the count
 * of a client's currently-open job_openings rows), the only real, FK-backed
 * signal available anywhere in this schema. No industry column and no
 * canonical role-type vocabulary exist to build the other candidate
 * dimensions on without fabricating categories.
 */
export const SEGMENTATION_CONFIG = {
  version: "segmentation-025-v1",
  dimension: "hiring_volume",
  // Inclusive lower bounds: 0-1 open roles -> low, 2-4 -> medium, 5+ -> high.
  thresholds: {
    medium: 2,
    high: 5,
  },
};
