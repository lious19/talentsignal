import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { computeCapacitySignalLookup, resolveCapacitySignal } from "../src/scoring/capacitySignal";

describe("computeCapacitySignalLookup", () => {
  it("reads and shapes every raw_capacity_signals row", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { source: "h1b-lca", employer_name_raw: "GITLAB INC.", event_date: "2026-01-01" },
          { source: "form-d", employer_name_raw: "Acme Corp", event_date: null },
        ],
      })),
    } as unknown as Pool;

    const lookup = await computeCapacitySignalLookup(pool);

    expect(lookup.rows).toEqual([
      { source: "h1b-lca", employerNameRaw: "GITLAB INC.", eventDate: "2026-01-01" },
      { source: "form-d", employerNameRaw: "Acme Corp", eventDate: null },
    ]);
  });
});

describe("resolveCapacitySignal", () => {
  const NOW = new Date("2026-09-09T00:00:00Z");

  it("returns basis none for an undefined lookup", () => {
    expect(resolveCapacitySignal("GitLab", undefined, NOW)).toEqual({ value: 0, basis: "none" });
  });

  it("returns basis none for an empty lookup", () => {
    expect(resolveCapacitySignal("GitLab", { rows: [] }, NOW)).toEqual({ value: 0, basis: "none" });
  });

  it("treats a null eventDate as not-within-window -- never a silent assumption that an undated signal is current", () => {
    const result = resolveCapacitySignal(
      "GitLab",
      { rows: [{ source: "h1b-lca", employerNameRaw: "GITLAB INC.", eventDate: null }] },
      NOW,
    );

    expect(result.basis).toBe("measured");
    expect(result.value).toBe(0); // recencyGate 0
    expect(result.recencyExcluded).toBe(true);
  });

  it("computes the exact recency boundary at 24 months", () => {
    const exactly24MonthsAgo = new Date(NOW);
    exactly24MonthsAgo.setMonth(exactly24MonthsAgo.getMonth() - 24);
    const withinResult = resolveCapacitySignal(
      "GitLab",
      { rows: [{ source: "h1b-lca", employerNameRaw: "GITLAB INC.", eventDate: exactly24MonthsAgo.toISOString().slice(0, 10) }] },
      NOW,
    );
    expect(withinResult.recencyExcluded).toBe(false);

    const twentyFiveMonthsAgo = new Date(NOW);
    twentyFiveMonthsAgo.setMonth(twentyFiveMonthsAgo.getMonth() - 25);
    const outsideResult = resolveCapacitySignal(
      "GitLab",
      { rows: [{ source: "h1b-lca", employerNameRaw: "GITLAB INC.", eventDate: twentyFiveMonthsAgo.toISOString().slice(0, 10) }] },
      NOW,
    );
    expect(outsideResult.recencyExcluded).toBe(true);
  });
});
