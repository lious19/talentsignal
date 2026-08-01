import { RELATIONSHIP_CONFIG } from "./relationshipConfig";

export type EdgeStrength = "strong" | "weak";

export interface PathEdgeInput {
  edgeId: string;
  relationshipType: string;
  strength: EdgeStrength;
}

export interface PathConfidenceFactor {
  edgeId: string | null;
  relationshipType: string;
  strength: EdgeStrength | null;
  contribution: number;
}

export interface PathConfidenceResult {
  confidence: number;
  factors: PathConfidenceFactor[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Multiplicative, not additive: a weak link anywhere drags the whole path
 * down, same reasoning as matchScore.ts's fit-score shape
 * (06_decisions/011) — an unreliable connector shouldn't be masked by a
 * strong second hop. The running product stays unrounded until the end to
 * avoid compounding rounding error across hops; only the returned
 * `confidence` and each factor's `contribution` are rounded, same
 * "round only at the boundary" convention as confidenceScore.ts/matchScore.ts.
 *
 * `contribution` here means "the multiplier this factor applied," not an
 * additive weight*value term — there's no such decomposition for a product.
 * It's still transparent and exact: multiply every factor's contribution
 * together and you get `confidence` back.
 */
export function scorePath(edges: PathEdgeInput[]): PathConfidenceResult {
  const { strengthScore, additionalHopPenalty } = RELATIONSHIP_CONFIG;

  const factors: PathConfidenceFactor[] = edges.map((edge) => ({
    edgeId: edge.edgeId,
    relationshipType: edge.relationshipType,
    strength: edge.strength,
    contribution: round3(strengthScore[edge.strength]),
  }));

  let confidence = edges.reduce((product, edge) => product * strengthScore[edge.strength], 1);

  // One penalty per hop beyond the first: a 1-edge path is 1 hop (no
  // penalty), a 2-edge path is 2 hops (one penalty) — matches the worked
  // example in 06_decisions/018.
  const extraHops = Math.max(edges.length - 1, 0);
  for (let i = 0; i < extraHops; i++) {
    confidence *= additionalHopPenalty;
    factors.push({
      edgeId: null,
      relationshipType: "additional-hop-penalty",
      strength: null,
      contribution: round3(additionalHopPenalty),
    });
  }

  return { confidence: round3(confidence), factors };
}

/**
 * The path's identity key, not its display/traversal order. Sorted so the
 * SAME real-world path always canonicalizes to the SAME array regardless of
 * which order a query happened to return its edges in — see
 * 008_relationship_edges.sql's comment on relationship_path_decisions.edge_ids
 * for the failure mode this prevents. Used by BOTH the GET route's status
 * lookup and the decide route's upsert, so they can never drift apart.
 */
export function canonicalEdgeIds(edgeIds: string[]): string[] {
  return [...edgeIds].sort();
}
