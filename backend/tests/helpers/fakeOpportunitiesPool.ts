import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeOpportunityRow {
  id: string;
  source: string;
  external_signal_id: string;
  company: string;
  confidence_score: string;
  reasons: string[];
  weights_version: string;
  factor_breakdown: unknown[];
  // HF-2 (migration 013): the second, independent score, mirroring the
  // confidence columns above so this fake stays faithful to the real row shape.
  hard_to_fill_score: string;
  hard_to_fill_reasons: string[];
  hard_to_fill_factors: unknown[];
  hard_to_fill_version: string;
  created_at: string;
  updated_at: string;
}

/**
 * In-memory stand-in for the opportunities table, faithful to the two things
 * that matter here: ON CONFLICT (source, external_signal_id) DO UPDATE
 * behaves as an upsert, never a second row (mirroring the real UNIQUE
 * constraint in 003_opportunities.sql), and the batch upsert in
 * hiddenDemand.ts's upsertBatch() is genuinely one query call regardless of
 * how many rows it carries — this fake mirrors that shape (seven parallel
 * array params, one query() call) rather than looping per row itself, so a
 * test asserting query.mock.calls.length actually proves something about the
 * real query, not an artifact of how the fake happens to be built.
 */
export function createFakeOpportunitiesPool() {
  const rows: FakeOpportunityRow[] = [];
  let nextId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO opportunities")) {
      const [
        sources, externalIds, companies, scores, reasonsJoined, weightsVersions, breakdownsJson,
        htfScores, htfReasonsJoined, htfBreakdownsJson, htfVersions, delimiter,
      ] = params as [
        string[], string[], string[], number[], string[], string[], string[],
        number[], string[], string[], string[], string,
      ];
      const now = new Date().toISOString();
      const returned: FakeOpportunityRow[] = [];

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const externalSignalId = externalIds[i];
        const company = companies[i];
        const confidenceScore = scores[i];
        const reasons = reasonsJoined[i].split(delimiter);
        const weightsVersion = weightsVersions[i];
        // pg parses jsonb columns automatically on the way back out of a real
        // query — this fake has to imitate that itself since it never
        // actually goes through Postgres.
        const factorBreakdown = JSON.parse(breakdownsJson[i]);
        // HF-2: same round-trip as the confidence columns above.
        const hardToFillScoreValue = String(htfScores[i]);
        const hardToFillReasons = htfReasonsJoined[i].split(delimiter);
        const hardToFillFactors = JSON.parse(htfBreakdownsJson[i]);
        const hardToFillVersion = htfVersions[i];

        const existing = rows.find(
          (r) => r.source === source && r.external_signal_id === externalSignalId,
        );
        if (existing) {
          existing.confidence_score = String(confidenceScore);
          existing.reasons = reasons;
          existing.weights_version = weightsVersion;
          existing.factor_breakdown = factorBreakdown;
          existing.hard_to_fill_score = hardToFillScoreValue;
          existing.hard_to_fill_reasons = hardToFillReasons;
          existing.hard_to_fill_factors = hardToFillFactors;
          existing.hard_to_fill_version = hardToFillVersion;
          existing.updated_at = now;
          returned.push(existing);
          continue;
        }
        const row: FakeOpportunityRow = {
          id: String(nextId++),
          source,
          external_signal_id: externalSignalId,
          company,
          confidence_score: String(confidenceScore),
          reasons,
          weights_version: weightsVersion,
          factor_breakdown: factorBreakdown,
          hard_to_fill_score: hardToFillScoreValue,
          hard_to_fill_reasons: hardToFillReasons,
          hard_to_fill_factors: hardToFillFactors,
          hard_to_fill_version: hardToFillVersion,
          created_at: now,
          updated_at: now,
        };
        rows.push(row);
        returned.push(row);
      }

      return { rows: returned };
    }

    if (sql.includes("WHERE id = ANY")) {
      const [ids] = params as [string[]];
      const idSet = new Set(ids);
      return { rows: rows.filter((r) => idSet.has(r.id)) };
    }

    if (sql.includes("SELECT * FROM opportunities")) {
      const filtered = sql.includes("WHERE source !=")
        ? rows.filter((r) => r.source !== "seed-job-board")
        : rows;
      return { rows: [...filtered].reverse() };
    }

    throw new Error(`fakeOpportunitiesPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    rows,
  };
}
