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

  it("is idempotent: the same signal always produces the same score and factor breakdown", () => {
    const signal = { ...BASE_SIGNAL, daysOpen: 24, isRepost: true, hasSalaryRange: false };

    expect(scoreSignal(signal)).toEqual(scoreSignal(signal));
  });

  it("always includes all four factors in a fixed order, even when a contribution is zero", () => {
    const { factors } = scoreSignal(BASE_SIGNAL); // not a repost, has a salary range

    expect(factors.map((f) => f.factor)).toEqual([
      "baseScore",
      "daysOpen",
      "repostedRole",
      "missingSalaryRange",
    ]);

    const repostedRole = factors.find((f) => f.factor === "repostedRole")!;
    expect(repostedRole.value).toBe(0);
    expect(repostedRole.contribution).toBe(0);

    const missingSalaryRange = factors.find((f) => f.factor === "missingSalaryRange")!;
    expect(missingSalaryRange.value).toBe(0);
    expect(missingSalaryRange.contribution).toBe(0);
  });

  it("reports each factor's configured weight alongside its value and contribution", () => {
    const { factors } = scoreSignal({ ...BASE_SIGNAL, isRepost: true, hasSalaryRange: false });

    const repostedRole = factors.find((f) => f.factor === "repostedRole")!;
    expect(repostedRole.weight).toBe(0.32);
    expect(repostedRole.value).toBe(1);
    expect(repostedRole.contribution).toBe(0.32);

    const missingSalaryRange = factors.find((f) => f.factor === "missingSalaryRange")!;
    expect(missingSalaryRange.weight).toBe(0.16);
    expect(missingSalaryRange.value).toBe(1);
    expect(missingSalaryRange.contribution).toBe(0.16);
  });

  it("the factor contributions sum to exactly the returned score", () => {
    const { score, factors } = scoreSignal({
      ...BASE_SIGNAL,
      daysOpen: 24,
      isRepost: true,
      hasSalaryRange: false,
    });

    const total = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0) * 1000) / 1000;
    expect(total).toBe(score);
  });

  it("stamps every result with the current confidence weights version", () => {
    const { weightsVersion } = scoreSignal(BASE_SIGNAL);
    expect(typeof weightsVersion).toBe("string");
    expect(weightsVersion.length).toBeGreaterThan(0);
  });
});
