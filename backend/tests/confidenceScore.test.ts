import { describe, expect, it } from "vitest";
import { scoreSignal } from "../src/scoring/confidenceScore";
import type { MarketSignal } from "../src/adapters/marketSignalProvider";

const BASE_SIGNAL: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-0000",
  company: "Test Co",
  title: "Engineer",
  daysOpen: 0,
  isRepost: false,
  hasSalaryRange: true,
};

describe("scoreSignal", () => {
  it("gives a brand-new, non-reposted, salary-disclosed posting a nonzero base score", () => {
    const { score, reasons } = scoreSignal(BASE_SIGNAL);

    expect(score).toBeCloseTo(0.2, 5);
    expect(reasons).toEqual(["open 0 days"]);
  });

  it("adds the reposted-role weight and reason when the signal is a repost", () => {
    const { score, reasons } = scoreSignal({ ...BASE_SIGNAL, isRepost: true });

    expect(score).toBeCloseTo(0.52, 5);
    expect(reasons).toContain("reposted role");
  });

  it("adds the missing-salary weight and reason when no range is disclosed", () => {
    const { score, reasons } = scoreSignal({ ...BASE_SIGNAL, hasSalaryRange: false });

    expect(score).toBeCloseTo(0.36, 5);
    expect(reasons).toContain("no salary range");
  });

  it("saturates the days-open contribution at the configured threshold", () => {
    const at30 = scoreSignal({ ...BASE_SIGNAL, daysOpen: 30 });
    const at200 = scoreSignal({ ...BASE_SIGNAL, daysOpen: 200 });

    expect(at30.score).toBeCloseTo(at200.score, 5);
  });

  it("stays within [0, 1] for the maximum-signal case", () => {
    const { score } = scoreSignal({
      ...BASE_SIGNAL,
      daysOpen: 30,
      isRepost: true,
      hasSalaryRange: false,
    });

    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBe(1);
  });
});
