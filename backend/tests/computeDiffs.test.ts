import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { computeDiff, normalizeChurnText } from "../src/ingestion/computeDiffs";

interface FakeState {
  // Prior raw_requisitions rows for THIS (source, external_id), oldest first.
  priorRows: { fetched_at: string; run_id: string | null; raw_response: unknown }[];
  // run_ids that have SOME OTHER external_id's row somewhere in the queried
  // window, before exclusion -- simulates wasPolledWithoutThisItem()'s real
  // query, including its run_id != ALL(excludeRunIds) filter, so a test can
  // prove same-run contamination is actually excluded, not just assume it.
  otherRunIdsInWindow: string[];
  // simulates hasPriorRequisitionIdSighting()'s query.
  priorRequisitionIdSighting: boolean;
}

function fakePool(state: Partial<FakeState>): Pool {
  const { priorRows = [], otherRunIdsInWindow = [], priorRequisitionIdSighting = false } = state;
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT fetched_at, run_id, raw_response")) {
        return { rows: priorRows };
      }
      if (sql.includes("SELECT DISTINCT run_id")) {
        // params: [source, externalId, excludeRunIds, from, to] -- mirrors
        // the real query's "run_id != ALL($3::uuid[])" filter.
        const excludeRunIds = (params[2] as string[]) ?? [];
        const remaining = otherRunIdsInWindow.filter((id) => !excludeRunIds.includes(id));
        return { rows: remaining.map((run_id) => ({ run_id })) };
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
  runId: "11111111-1111-1111-1111-111111111113",
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
  const priorRunId = "11111111-1111-1111-1111-111111111111";
  const prior = [
    {
      fetched_at: "2026-08-13T00:00:00Z",
      run_id: priorRunId,
      raw_response: { title: "Data Analyst", description: "<div>Analyze data.</div>" },
    },
  ];

  it("criterion 3: identical title/description since the prior fetch -> no-op (churn 0, repost 0)", async () => {
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [] });
    const result = await computeDiff(pool, baseInput);
    expect(result.descriptionChurn).toBe(0);
    expect(result.repostCount).toBe(0);
  });

  it("criterion 2: title changed, no board-poll gap -> churn +1, repost stays 0", async () => {
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [] });
    const result = await computeDiff(pool, { ...baseInput, title: "Senior Data Analyst" });
    expect(result.descriptionChurn).toBe(1);
    expect(result.repostCount).toBe(0);
  });

  it("both title and description changed in the same fetch -> 1 increment, not 2 (06_decisions/044)", async () => {
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [] });
    const result = await computeDiff(pool, {
      ...baseInput,
      title: "Senior Data Analyst",
      description: "<div>Analyze data at scale.</div>",
    });
    expect(result.descriptionChurn).toBe(1);
  });

  it("a whitespace/markup-only difference is not churn (normalized comparison)", async () => {
    const reflowed = [
      {
        fetched_at: "2026-08-13T00:00:00Z",
        run_id: priorRunId,
        raw_response: { title: "Data Analyst", description: "  <div>Analyze   data.</div>  " },
      },
    ];
    const pool = fakePool({ priorRows: reflowed, otherRunIdsInWindow: [] });
    const result = await computeDiff(pool, baseInput);
    expect(result.descriptionChurn).toBe(0);
  });

  it("criterion 1: a genuinely DIFFERENT run polled this source without this item -> repost +1", async () => {
    // A run that is neither prior's own run nor this fetch's own run --
    // this is the only shape that should count as a real gap.
    const genuinelyOtherRun = "22222222-2222-2222-2222-222222222222";
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [genuinelyOtherRun] });
    const result = await computeDiff(pool, baseInput);
    expect(result.repostCount).toBe(1);
  });

  it("regression (CI run #8 on f1b374c): another item's row from the SAME run as either bracketing sighting must NOT count as a gap", async () => {
    // Only run_ids matching prior's own run and this fetch's own run have
    // other rows -- i.e. board-mates persisted moments earlier/later within
    // the SAME two ingestion calls, not a genuine intervening poll. Before
    // the fix, wasPolledWithoutThisItem() didn't exclude these, producing a
    // phantom repost for an item that never actually disappeared.
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [priorRunId, baseInput.runId] });
    const result = await computeDiff(pool, baseInput);
    expect(result.repostCount).toBe(0);
  });

  it("idempotency: calling computeDiff twice against the same raw_requisitions state produces the same result both times", async () => {
    const genuinelyOtherRun = "33333333-3333-3333-3333-333333333333";
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [genuinelyOtherRun] });
    const first = await computeDiff(pool, baseInput);
    const second = await computeDiff(pool, baseInput);
    expect(second).toEqual(first);
  });

  it("daysOpen is anchored to this fetch's fetchedAt, not wall-clock now (reproducible re-runs, criterion 3)", async () => {
    const pool = fakePool({ priorRows: prior, otherRunIdsInWindow: [] });
    const result = await computeDiff(pool, baseInput);
    expect(result.daysOpen).toBe(50); // 2026-07-01 -> 2026-08-20
  });
});
