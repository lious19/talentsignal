import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { scorePath, canonicalEdgeIds, type PathConfidenceFactor } from "../relationships/pathConfidence";
import type { OpportunityRow } from "./hiddenDemand";

type NodeType = "user" | "client";

interface EdgeRow {
  id: string;
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  relationship_type: string;
  strength: "strong" | "weak";
}

interface DecisionRow {
  edge_ids: string[];
  decision: "confirmed" | "dismissed";
}

interface RawPath {
  edges: EdgeRow[];
  userIds: string[];
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Undirected lookup: relationship_edges stores one row per relationship, not
// two, so both sides have to be checked regardless of which column an edge
// happened to be inserted into. Returns the OTHER side of the edge relative
// to the given anchor, or null if the edge doesn't touch that anchor at all.
function otherSide(
  edge: EdgeRow,
  anchorType: NodeType,
  anchorId: string,
): { type: NodeType; id: string } | null {
  if (edge.from_type === anchorType && edge.from_id === anchorId) {
    return { type: edge.to_type, id: edge.to_id };
  }
  if (edge.to_type === anchorType && edge.to_id === anchorId) {
    return { type: edge.from_type, id: edge.from_id };
  }
  return null;
}

// Small in-memory cross product, not a recursive CTE — at demo/seed scale
// the whole edges table is tiny, and "don't over-engineer" is Ali's own
// framing for this story. Finds every 1-hop (user directly connected to the
// client) and 2-hop (user connected to a colleague who is connected to the
// client) path.
function findPaths(edges: EdgeRow[], clientId: string): RawPath[] {
  const paths: RawPath[] = [];

  const oneHopEdges = edges.filter((edge) => otherSide(edge, "client", clientId)?.type === "user");
  for (const edge of oneHopEdges) {
    const connector = otherSide(edge, "client", clientId)!;
    paths.push({ edges: [edge], userIds: [connector.id] });
  }

  const userUserEdges = edges.filter((edge) => edge.from_type === "user" && edge.to_type === "user");
  for (const oneHop of oneHopEdges) {
    const user1 = otherSide(oneHop, "client", clientId)!.id;
    for (const colleagueEdge of userUserEdges) {
      const other = otherSide(colleagueEdge, "user", user1);
      if (other && other.id !== user1) {
        paths.push({ edges: [colleagueEdge, oneHop], userIds: [other.id, user1] });
      }
    }
  }

  return paths;
}

interface RelationshipPathResponse {
  edgeIds: string[];
  hops: number;
  userIds: string[];
  confidence: number;
  factors: PathConfidenceFactor[];
  status: "unconfirmed" | "confirmed" | "dismissed";
}

function toPathResponse(
  path: RawPath,
  decisionsByKey: Map<string, DecisionRow["decision"]>,
): RelationshipPathResponse {
  const { confidence, factors } = scorePath(
    path.edges.map((edge) => ({
      edgeId: edge.id,
      relationshipType: edge.relationship_type,
      strength: edge.strength,
    })),
  );
  const key = canonicalEdgeIds(path.edges.map((edge) => edge.id)).join(",");
  return {
    edgeIds: path.edges.map((edge) => edge.id),
    hops: path.edges.length,
    userIds: path.userIds,
    confidence,
    factors,
    status: decisionsByKey.get(key) ?? "unconfirmed",
  };
}

// Ranked by confidence descending; the canonical edge-id key is the
// tiebreak, so equal-confidence paths don't reorder nondeterministically —
// same reasoning as every other byXThenId sorter in this codebase.
function byConfidenceThenKey(a: RelationshipPathResponse, b: RelationshipPathResponse): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const aKey = canonicalEdgeIds(a.edgeIds).join(",");
  const bKey = canonicalEdgeIds(b.edgeIds).join(",");
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

function isValidEdgeIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id.trim().length > 0);
}

function isValidDecision(value: unknown): value is "confirmed" | "dismissed" {
  return value === "confirmed" || value === "dismissed";
}

export function opportunityRelationshipsRouter(pool: Pool): Router {
  const router = Router();

  // Read-only, side-effect-free suggestion endpoint (REQ-006/REQ-020): never
  // writes, never contacts the connector, never leaves the platform.
  // `client: null, paths: []` is a valid, honest response — not an error —
  // when no client's name matches the opportunity's company (06_decisions/017).
  router.get("/opportunities/:id/relationships", requireAuth, async (req, res) => {
    const opportunityId = req.params.id;

    try {
      const opportunityResult = await pool.query("SELECT * FROM opportunities WHERE id = $1", [
        opportunityId,
      ]);
      if (opportunityResult.rows.length === 0) {
        res.status(404).json({ error: "opportunity not found" });
        return;
      }
      const opportunity = opportunityResult.rows[0] as OpportunityRow;

      const clientResult = await pool.query(
        "SELECT id, name FROM clients WHERE lower(name) = lower($1) LIMIT 1",
        [opportunity.company],
      );
      if (clientResult.rows.length === 0) {
        res.status(200).json({ client: null, paths: [] });
        return;
      }
      const client = clientResult.rows[0] as { id: string; name: string };

      const [{ rows: edgeRows }, { rows: decisionRows }] = await Promise.all([
        pool.query("SELECT * FROM relationship_edges"),
        pool.query("SELECT edge_ids, decision FROM relationship_path_decisions WHERE opportunity_id = $1", [
          opportunityId,
        ]),
      ]);

      const decisionsByKey = new Map<string, DecisionRow["decision"]>();
      for (const row of decisionRows as DecisionRow[]) {
        decisionsByKey.set(canonicalEdgeIds(row.edge_ids).join(","), row.decision);
      }

      const rawPaths = findPaths(edgeRows as EdgeRow[], client.id);
      const paths = rawPaths.map((path) => toPathResponse(path, decisionsByKey)).sort(byConfidenceThenKey);

      logger.info(
        { correlationId: req.correlationId, opportunityId, clientId: client.id, count: paths.length },
        "opportunity relationships surfaced",
      );
      res.status(200).json({ client: { id: client.id, name: client.name }, paths });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunity relationships lookup failed");
      res.status(500).json({ error: "relationships lookup failed" });
    }
  });

  // The human-in-the-loop gate (REQ-020, same DNA as S-09's release):
  // deliberately NOT terminal — a rep can change a confirm to a dismiss or
  // back, because this only gates an internal signal-quality flag, not
  // anything leaving the platform. edgeIds is canonicalized through the
  // SAME helper the GET route uses for its lookup key, so a path confirmed
  // here is reliably found as "confirmed" on a later GET regardless of
  // traversal order, and a repeat decision updates the one row instead of
  // creating a duplicate.
  router.post("/opportunities/:id/relationships/decide", requireAuth, async (req, res) => {
    const opportunityId = req.params.id;
    const edgeIds = req.body?.edgeIds;
    const decision = req.body?.decision;

    if (!isValidId(opportunityId)) {
      res.status(400).json({ error: "opportunityId is required" });
      return;
    }
    if (!isValidEdgeIds(edgeIds)) {
      res.status(400).json({ error: "edgeIds must be a non-empty array of strings" });
      return;
    }
    if (!isValidDecision(decision)) {
      res.status(400).json({ error: "decision must be 'confirmed' or 'dismissed'" });
      return;
    }

    try {
      const opportunityResult = await pool.query("SELECT id FROM opportunities WHERE id = $1", [
        opportunityId,
      ]);
      if (opportunityResult.rows.length === 0) {
        res.status(404).json({ error: "opportunity not found" });
        return;
      }

      const canonical = canonicalEdgeIds(edgeIds);
      const { rows } = await pool.query(
        `INSERT INTO relationship_path_decisions (opportunity_id, edge_ids, decision, decided_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (opportunity_id, edge_ids)
         DO UPDATE SET decision = EXCLUDED.decision, decided_by = EXCLUDED.decided_by, decided_at = now()
         RETURNING *`,
        [opportunityId, canonical, decision, req.user!.id],
      );
      const row = rows[0];

      logger.info(
        { correlationId: req.correlationId, opportunityId, edgeIds: canonical, decision },
        "relationship path decision recorded",
      );
      res.status(200).json({
        pathDecision: {
          opportunityId: row.opportunity_id,
          edgeIds: row.edge_ids,
          decision: row.decision,
          decidedBy: row.decided_by,
          decidedAt: row.decided_at,
        },
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "relationship path decision failed");
      res.status(500).json({ error: "decision failed" });
    }
  });

  return router;
}
