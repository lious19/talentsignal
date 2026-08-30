import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { computeDiff, normalizeChurnText } from "../src/ingestion/computeDiffs";

interface FakeState {
  // Prior raw_requisitions rows for THIS (source, external_id), oldest first.
  priorRows: { fetched_at: string; raw_response: unknown }[];
  // run_ids that "polled the board" (other items got rows) inside a given
  // window -- simulates wasPolledWithoutThisItem()'s query.
  gapRunsInWindow: boolean;
  // simulates hasPriorRequisitionIdSighting()'s query.
  priorRequisitionIdSighting: boolean;
}

function fakePool(state: Partial<FakeState>): Pool {
  const { priorRows = [], gapRunsInWindow = false, priorRequisitionIdSighting = false } = state;
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT fetched_at, raw_response")) {
        return { rows: priorRows };
      }
      if (sql.includes("SELECT DISTINCT run_id")) {
        return { rows: gapRunsInWindow ? [{ run_id: "other-run" }] : [] };
      }
      if (sql.includes("requisition_id' = $4")) {
        return { rows: [{ n: priorRequisitionIdSighting ? 1 : 0 }] };
      }
      throw new Error(`fakePool: unexpected query — ${sql}`);
    }),
  } as unknown as Pool;
}

const extractText = (rawResponse: unknown) => rawResponse as { title: string; description: string };

const baseInput = {
  source: "greenhouse",
  externalId: "job-1",
  runId: "run-3",
  rawRowId: "row-3",
  fetchedAt: new Date("2026-08-20T00:00:00Z"),
  title: "Data Analyst",
  description: "<div>Analyze data.</div>",
  openedAt: new Date("2026-07-01T00:00:00Z"),
  extractText,
};

describe("normalizeChurnText", () => {
  it("strips HTML tags after decoding entities (Greenhouse's double-escaped content)", () => {
    expect(normalizeChurnText("&lt;div&gt;Analyze data.&lt;/div&gt;")).toBe("Analyze data.");
  });

  it("strips raw HTML tags directly (Lever's content is not entity-escaped)", () => {
    expect(normalizeChurnText("<div>Analyze data.</div>")).toBe("Analyze data.");
  });

  it("collapses whitespace and trims -- an upstream reflow is not churn", () => {
    expect(normalizeChurnText("  Analyze   data.\n\n ")).toBe("Analyze data.");
    expect(normalizeChurnText("Analyze data.")).toBe(normalizeChurnText("  Analyze   data.\n\n "));
  });

  it("does NOT normalize case -- a capitalization rewrite is a real edit (06_decisions/044)", () => {
    expect(normalizeChurnText("URGENT: Data Analyst")).not.toBe(normalizeChurnText("Data Analyst"));
  });
});

describe("computeDiff — first sighting (no prior raw_requisitions rows)", () => {
  it("repostCount 0, descriptionChurn 0, daysOpen from openedAt to this fetch, when no requisitionId given", async () => {
    const pool = fakePool({ priorRows: [] });
    const result = await computeDiff(pool, baseInput);
    expect(result).toEqual({ repostCount: 0, descriptionChurn: 0, daysOpen: 50 });
  });

  it("repostCount 1 when this requisition_id was already seen under a different external_id (criterion 1's requisition_id path, 06_decisions/043)", async () => {
    const pool = fakePool({ priorRows: [], priorRequisitionIdSighting: true });
    const result = await computeDiff(pool, { ...baseInput, requisitionId: "9001" });
    expect(result.repostCount).toBe(1);
  });

  it("repostCount 0 when a requisitionId is given but never seen before", async () => {
    const pool = fakePool({ priorRows: [], priorRequisitionIdSighting: false });
    const result = await computeDiff(pool, { ...baseInput, requisitionId: "9001" });
    expect(result.repostCount).toBe(0);
  });
});

describe("computeDiff — repeat sighting (prior rows exist)", () => {
  const prior = [
    {
      fetched_at: "2026-08-13T00:00:00Z",
      raw_response: { title: "Data Analyst", description: "<div>Analyze data.</div>" },
    },
  ];

  it("criterion 3: identical title/description since the prior fetch -> no-op (churn 0, repost 0)", async () => {
    const pool = fakePool({ priorRows: prior, gapRunsInWindow: false });
    const result = await computeDiff(pool, baseInput);
    expect(result.descriptionChurn).toBe(0);
    expect(result.repostCount).toBe(0);
  });

  it("criterion 2: title changed, no board-poll gap -> churn +1, repost stays 0", async () => {
    const pool = fakePool({ priorRows: prior, gapRunsInWindow: false });
    const result = await computeDiff(pool, { ...baseInput, title: "Senior Data Analyst" });
    expect(result.descriptionChurn).toBe(1);
    expect(result.repostCount).toBe(0);
  });

  it("both title and description changed in the same fetch -> 1 increment, not 2 (06_decisions/044)", async () => {
    const pool = fakePool({ priorRows: prior, gapRunsInWindow: false });
    const result = await computeDiff(pool, {
      ...baseInput,
      title: "Senior Data Analyst",
      description: "<div>Analyze data at scale.</div>",
    });
    expect(result.descriptionChurn).toBe(1);
  });

  it("a whitespace/markup-only difference is not churn (normalized comparison)", async () => {
    const reflowed = [
      { fetched_at: "2026-08-13T00:00:00Z", raw_response: { title: "Data Analyst", description: "  <div>Analyze   data.</div>  " } },
    ];
    const pool = fakePool({ priorRows: reflowed, gapRunsInWindow: false });
    const result = await computeDiff(pool, baseInput);
    expect(result.descriptionChurn).toBe(0);
  });

  it("criterion 1: this source was polled (another item got a row) in the gap between fetches, without this item -> repost +1", async () => {
    const pool = fakePool({ priorRows: prior, gapRunsInWindow: true });
    const result = await computeDiff(pool, baseInput);
    expect(result.repostCount).toBe(1);
  });

  it("daysOpen is anchored to this fetch's fetchedAt, not wall-clock now (reproducible re-runs, criterion 3)", async () => {
    const pool = fakePool({ priorRows: prior, gapRunsInWindow: false });
    const result = await computeDiff(pool, baseInput);
    expect(result.daysOpen).toBe(50); // 2026-07-01 -> 2026-08-20
  });
});
