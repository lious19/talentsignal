import { describe, expect, it } from "vitest";
import { hardToFillScore } from "../src/scoring/hardToFillScore";
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

describe("hardToFillScore", () => {
  it("gives a generic, fresh, non-reposted posting a score of exactly 0 (no base score)", () => {
    const { score, reasons } = hardToFillScore(BASE_SIGNAL);

    expect(score).toBe(0);
    expect(reasons).toEqual(["open 0 days"]);
  });

  it("scores an in-demand role open a while and reposted as high", () => {
    const { score, reasons } = hardToFillScore({
      ...BASE_SIGNAL,
      title: "Senior Data Analyst",
      daysOpen: 30,
      isRepost: true,
    });

    expect(score).toBe(1);
    expect(reasons).toContain("in-demand role type");
  });

  it("matches role keywords case-insensitively", () => {
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "SENIOR DATA SCIENTIST" });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(1);
  });

  it("matches a role keyword as a substring inside a longer title", () => {
    const { factors } = hardToFillScore({
      ...BASE_SIGNAL,
      title: "Staff AI Architect - Applied Research Group",
    });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(1);
  });

  it("does not match a generic title against any keyword", () => {
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "Sales Associate" });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(0);
    expect(roleScarcity.contribution).toBe(0);
  });

  it("adds the reposted-role weight and reason when the signal is a repost", () => {
    const { score, reasons } = hardToFillScore({ ...BASE_SIGNAL, isRepost: true });

    expect(score).toBeCloseTo(0.2, 5);
    expect(reasons).toContain("reposted role");
  });

  it("saturates the days-open contribution at the configured threshold", () => {
    const at30 = hardToFillScore({ ...BASE_SIGNAL, daysOpen: 30 });
    const at200 = hardToFillScore({ ...BASE_SIGNAL, daysOpen: 200 });

    expect(at30.score).toBeCloseTo(at200.score, 5);
  });

  it("stays within [0, 1] for the maximum-signal case", () => {
    const { score } = hardToFillScore({
      ...BASE_SIGNAL,
      title: "Data Engineer",
      daysOpen: 30,
      isRepost: true,
    });

    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBe(1);
  });

  it("is idempotent: the same signal always produces the same score and factor breakdown", () => {
    const signal = { ...BASE_SIGNAL, title: "Cybersecurity Analyst", daysOpen: 24, isRepost: true };

    expect(hardToFillScore(signal)).toEqual(hardToFillScore(signal));
  });

  it("always includes all three factors in a fixed order, even when a contribution is zero", () => {
    const { factors } = hardToFillScore(BASE_SIGNAL); // generic title, not a repost

    expect(factors.map((f) => f.factor)).toEqual(["roleScarcity", "daysOpen", "repostedRole"]);

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(0);
    expect(roleScarcity.contribution).toBe(0);

    const repostedRole = factors.find((f) => f.factor === "repostedRole")!;
    expect(repostedRole.value).toBe(0);
    expect(repostedRole.contribution).toBe(0);
  });

  it("reports each factor's configured weight alongside its value and contribution", () => {
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "ML Engineer", isRepost: true });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.weight).toBe(0.6);
    expect(roleScarcity.value).toBe(1);
    expect(roleScarcity.contribution).toBe(0.6);

    const repostedRole = factors.find((f) => f.factor === "repostedRole")!;
    expect(repostedRole.weight).toBe(0.2);
    expect(repostedRole.value).toBe(1);
    expect(repostedRole.contribution).toBe(0.2);
  });

  it("the factor contributions sum to exactly the returned score", () => {
    const { score, factors } = hardToFillScore({
      ...BASE_SIGNAL,
      title: "Cloud Architect",
      daysOpen: 24,
      isRepost: true,
    });

    const total = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0) * 1000) / 1000;
    expect(total).toBe(score);
  });

  it("stamps every result with the current hard-to-fill config version", () => {
    const { version } = hardToFillScore(BASE_SIGNAL);
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("is graceful on an empty title", () => {
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "" });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(0);
  });

  it("is graceful on a whitespace-only title", () => {
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "   " });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(0);
  });

  it("is graceful on a very long title with a keyword buried in the middle", () => {
    const longTitle = "x".repeat(2000) + " data engineer " + "y".repeat(2000);
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: longTitle });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(1);
  });

  it("matches across punctuation now that keyword matching is word-boundary based (S-23 fix)", () => {
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "Sr. Data-Analyst" });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(1);
  });
});
