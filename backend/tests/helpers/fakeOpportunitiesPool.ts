import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeOpportunityRow {
  id: string;
  source: string;
  external_signal_id: string;
  company: string;
  confidence_score: string;
  reasons: string[];
  created_at: string;
  updated_at: string;
}

/**
 * In-memory stand-in for the opportunities table, faithful to the one thing
 * that matters here: ON CONFLICT (source, external_signal_id) DO UPDATE
 * behaves as an upsert, never a second row, mirroring the real UNIQUE
 * constraint in 003_opportunities.sql.
 */
export function createFakeOpportunitiesPool() {
  const rows: FakeOpportunityRow[] = [];
  let nextId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO opportunities")) {
      const [source, externalSignalId, company, confidenceScore, reasons] = params as [
        string,
        string,
        string,
        number,
        string[],
      ];
      const now = new Date().toISOString();
      const existing = rows.find(
        (r) => r.source === source && r.external_signal_id === externalSignalId,
      );
      if (existing) {
        existing.confidence_score = String(confidenceScore);
        existing.reasons = reasons;
        existing.updated_at = now;
        return { rows: [existing] };
      }
      const row: FakeOpportunityRow = {
        id: String(nextId++),
        source,
        external_signal_id: externalSignalId,
        company,
        confidence_score: String(confidenceScore),
        reasons,
        created_at: now,
        updated_at: now,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes("SELECT * FROM opportunities")) {
      return { rows: [...rows].reverse() };
    }

    throw new Error(`fakeOpportunitiesPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    rows,
  };
}
