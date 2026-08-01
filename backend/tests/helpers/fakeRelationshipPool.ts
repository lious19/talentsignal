import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeOpportunityRow {
  id: string;
  company: string;
}

export interface FakeClientRow {
  id: string;
  name: string;
}

export interface FakeEdgeRow {
  id: string;
  from_type: "user" | "client";
  from_id: string;
  to_type: "user" | "client";
  to_id: string;
  relationship_type: string;
  strength: "strong" | "weak";
}

export interface FakeDecisionRow {
  id: string;
  opportunity_id: string;
  edge_ids: string[];
  decision: "confirmed" | "dismissed";
  decided_by: string;
  decided_at: string;
}

function sameEdgeIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * In-memory stand-in for opportunities + clients (read-only lookups here)
 * plus relationship_edges + relationship_path_decisions (the tables this
 * router actually reads/writes).
 *
 * Deliberately alternates the ORDER relationship_edges rows come back in on
 * successive calls (as-seeded, then reversed, then as-seeded, ...) — this is
 * what makes the canonical-key regression test genuine rather than
 * accidentally passing because a fake always iterates the same way twice. A
 * real Postgres query offers no row-order guarantee without an ORDER BY
 * either, so this is a faithful, not adversarial, stand-in.
 */
export function createFakeRelationshipPool() {
  const opportunities: FakeOpportunityRow[] = [];
  const clients: FakeClientRow[] = [];
  const edges: FakeEdgeRow[] = [];
  const decisions: FakeDecisionRow[] = [];
  let nextOpportunityId = 1;
  let nextClientId = 1;
  let nextEdgeId = 1;
  let nextDecisionId = 1;
  let edgeQueryCount = 0;

  function seedOpportunity(overrides: Partial<FakeOpportunityRow> = {}): FakeOpportunityRow {
    const row: FakeOpportunityRow = {
      id: `opportunity-${nextOpportunityId++}`,
      company: "Acme Corp",
      ...overrides,
    };
    opportunities.push(row);
    return row;
  }

  function seedClient(overrides: Partial<FakeClientRow> = {}): FakeClientRow {
    const row: FakeClientRow = {
      id: `client-${nextClientId++}`,
      name: "Acme Corp",
      ...overrides,
    };
    clients.push(row);
    return row;
  }

  function seedEdge(
    overrides: Partial<FakeEdgeRow> & {
      fromType: "user" | "client";
      fromId: string;
      toType: "user" | "client";
      toId: string;
      relationshipType: string;
      strength: "strong" | "weak";
    },
  ): FakeEdgeRow {
    const row: FakeEdgeRow = {
      id: `edge-${nextEdgeId++}`,
      from_type: overrides.fromType,
      from_id: overrides.fromId,
      to_type: overrides.toType,
      to_id: overrides.toId,
      relationship_type: overrides.relationshipType,
      strength: overrides.strength,
    };
    edges.push(row);
    return row;
  }

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM opportunities WHERE id")) {
      const [id] = params as [string];
      const row = opportunities.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes("FROM clients WHERE lower(name) = lower")) {
      const [name] = params as [string];
      const row = clients.find((r) => r.name.toLowerCase() === name.toLowerCase());
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith("SELECT * FROM relationship_edges")) {
      edgeQueryCount += 1;
      const ordered = edgeQueryCount % 2 === 0 ? [...edges].reverse() : [...edges];
      return { rows: ordered };
    }

    if (sql.includes("FROM relationship_path_decisions WHERE opportunity_id")) {
      const [opportunityId] = params as [string];
      return {
        rows: decisions
          .filter((d) => d.opportunity_id === opportunityId)
          .map((d) => ({ edge_ids: d.edge_ids, decision: d.decision })),
      };
    }

    if (sql.includes("INSERT INTO relationship_path_decisions")) {
      const [opportunityId, edgeIds, decision, decidedBy] = params as [
        string,
        string[],
        "confirmed" | "dismissed",
        string,
      ];
      const existing = decisions.find(
        (d) => d.opportunity_id === opportunityId && sameEdgeIds(d.edge_ids, edgeIds),
      );
      if (existing) {
        existing.decision = decision;
        existing.decided_by = decidedBy;
        existing.decided_at = new Date().toISOString();
        return { rows: [existing] };
      }
      const row: FakeDecisionRow = {
        id: `decision-${nextDecisionId++}`,
        opportunity_id: opportunityId,
        edge_ids: edgeIds,
        decision,
        decided_by: decidedBy,
        decided_at: new Date().toISOString(),
      };
      decisions.push(row);
      return { rows: [row] };
    }

    throw new Error(`fakeRelationshipPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    opportunities,
    clients,
    edges,
    decisions,
    seedOpportunity,
    seedClient,
    seedEdge,
  };
}
