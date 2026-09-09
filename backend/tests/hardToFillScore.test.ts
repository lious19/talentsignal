import { describe, expect, it } from "vitest";
import { hardToFillScore } from "../src/scoring/hardToFillScore";
import { HARD_TO_FILL_CONFIG } from "../src/scoring/hardToFillConfig";
import type { MarketSignal } from "../src/adapters/marketSignalProvider";
import type { FamilyScarcityLookup } from "../src/scoring/familyScarcity";
import type { CapacitySignalLookup } from "../src/scoring/capacitySignal";

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
    // S-24 (v3 reweight): 1*0.48 (roleScarcity) + 1*0.16 (daysOpen, 30/30
    // saturated) + 1*0.16 (repostedRole) + 0 (no capacitySignal lookup) = 0.8
    // -- no longer 1.0 now that capacitySignal claims 0.2 of the total
    // weight budget (06_decisions/047).
    const { score, reasons } = hardToFillScore({
      ...BASE_SIGNAL,
      title: "Senior Data Analyst",
      daysOpen: 30,
      isRepost: true,
    });

    expect(score).toBe(0.8);
    expect(reasons).toContain("role scarcity: curated (matched decision-026 keyword)");
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
    // S-24 (v3 reweight): repostedRole is 0.16 now, not 0.2.
    const { score, reasons } = hardToFillScore({ ...BASE_SIGNAL, isRepost: true });

    expect(score).toBeCloseTo(0.16, 5);
    expect(reasons).toContain("reposted role");
  });

  it("saturates the days-open contribution at the configured threshold", () => {
    const at30 = hardToFillScore({ ...BASE_SIGNAL, daysOpen: 30 });
    const at200 = hardToFillScore({ ...BASE_SIGNAL, daysOpen: 200 });

    expect(at30.score).toBeCloseTo(at200.score, 5);
  });

  it("stays within [0, 1] for the maximum non-capacity signal case", () => {
    // S-24 (v3 reweight): the other three factors alone now cap at 0.8
    // (0.48 + 0.16 + 0.16) -- reaching a true 1.0 requires a capacitySignal
    // contribution too, see the capacitySignal describe block below.
    const { score } = hardToFillScore({
      ...BASE_SIGNAL,
      title: "Data Engineer",
      daysOpen: 30,
      isRepost: true,
    });

    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBe(0.8);
  });

  it("is idempotent: the same signal always produces the same score and factor breakdown", () => {
    const signal = { ...BASE_SIGNAL, title: "Cybersecurity Analyst", daysOpen: 24, isRepost: true };

    expect(hardToFillScore(signal)).toEqual(hardToFillScore(signal));
  });

  it("always includes all four factors in a fixed order, even when a contribution is zero", () => {
    const { factors } = hardToFillScore(BASE_SIGNAL); // generic title, not a repost, no capacity lookup

    expect(factors.map((f) => f.factor)).toEqual(["roleScarcity", "daysOpen", "repostedRole", "capacitySignal"]);

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.value).toBe(0);
    expect(roleScarcity.contribution).toBe(0);

    const repostedRole = factors.find((f) => f.factor === "repostedRole")!;
    expect(repostedRole.value).toBe(0);
    expect(repostedRole.contribution).toBe(0);

    const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
    expect(capacitySignal.basis).toBe("none");
    expect(capacitySignal.value).toBe(0);
    expect(capacitySignal.contribution).toBe(0);
  });

  it("reports each factor's configured weight alongside its value and contribution", () => {
    // S-24 (v3 reweight): roleScarcity 0.6->0.48, repostedRole 0.2->0.16.
    const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "ML Engineer", isRepost: true });

    const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
    expect(roleScarcity.weight).toBe(0.48);
    expect(roleScarcity.value).toBe(1);
    expect(roleScarcity.contribution).toBe(0.48);

    const repostedRole = factors.find((f) => f.factor === "repostedRole")!;
    expect(repostedRole.weight).toBe(0.16);
    expect(repostedRole.value).toBe(1);
    expect(repostedRole.contribution).toBe(0.16);

    const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
    expect(capacitySignal.weight).toBe(0.2);
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

  describe("S-23: measured roleScarcity", () => {
    // SYNTHETIC FIXTURE, not live data -- see 05_presentations/S-23-exploration.md
    // for the real-data proof. This fixture exists purely to prove the
    // MECHANISM works in isolation: two families, both with n>=10 real
    // observations, sitting at different multiples of the global median,
    // must produce different roleScarcity values and different total scores
    // regardless of what today's live dataset happens to contain.
    const SYNTHETIC_FAMILY_SCARCITY: FamilyScarcityLookup = {
      globalMedianDaysOpen: 30,
      byFamily: {
        "ml-ai": { count: 14, medianDaysOpen: 60 }, // exactly 2x global -> saturates at 1.0
        "support-cs": { count: 12, medianDaysOpen: 15 }, // 0.5x global -> 0.25
      },
    };

    it("PROVES criterion 1 mechanically: a Staff ML posting and a Help Desk posting, both from measured families with n>=10, score differently", () => {
      const staffMl = hardToFillScore(
        { ...BASE_SIGNAL, source: "greenhouse", title: "Staff ML Engineer", daysOpen: 60 },
        SYNTHETIC_FAMILY_SCARCITY,
      );
      const helpDesk = hardToFillScore(
        { ...BASE_SIGNAL, source: "greenhouse", title: "Help Desk Analyst", daysOpen: 15 },
        SYNTHETIC_FAMILY_SCARCITY,
      );

      const mlFactor = staffMl.factors.find((f) => f.factor === "roleScarcity")!;
      const helpDeskFactor = helpDesk.factors.find((f) => f.factor === "roleScarcity")!;

      expect(mlFactor.basis).toBe("measured");
      expect(helpDeskFactor.basis).toBe("measured");
      expect(mlFactor.value).toBe(1);
      expect(helpDeskFactor.value).toBe(0.25);
      expect(mlFactor.value).not.toBe(helpDeskFactor.value);
      expect(staffMl.score).not.toBe(helpDesk.score);

      expect(staffMl.reasons).toContain("role scarcity: measured (family 'ml-ai', median 60d vs global 30d)");
      expect(helpDesk.reasons).toContain("role scarcity: measured (family 'support-cs', median 15d vs global 30d)");
    });

    it("falls back to curated when the family has fewer than the observation threshold, and says so (criterion 2)", () => {
      const thin: FamilyScarcityLookup = {
        globalMedianDaysOpen: 30,
        byFamily: { "cloud-infra": { count: 4, medianDaysOpen: 90 } }, // below familyObservationThreshold (10)
      };

      const { factors, reasons } = hardToFillScore(
        { ...BASE_SIGNAL, source: "greenhouse", title: "Cloud Architect", daysOpen: 90 },
        thin,
      );

      const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
      expect(roleScarcity.basis).toBe("curated"); // "cloud architect" is still on the decision-026 list
      expect(roleScarcity.value).toBe(1);
      expect(reasons).toContain("role scarcity: curated (matched decision-026 keyword)");
    });

    it("never uses the measured basis for a Lever-sourced signal, even when its family clears the threshold (source exclusion, 06_decisions/046)", () => {
      const wouldQualifyIfGreenhouse: FamilyScarcityLookup = {
        globalMedianDaysOpen: 30,
        byFamily: { "ml-ai": { count: 14, medianDaysOpen: 60 } },
      };

      const { factors, reasons } = hardToFillScore(
        { ...BASE_SIGNAL, source: "lever", title: "AI Product Manager", daysOpen: 60 },
        wouldQualifyIfGreenhouse,
      );

      const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
      // "AI Product Manager" classifies as ml-ai (via the broad "ai" token)
      // but isn't itself on the decision-026 curated list, so with measured
      // basis excluded, nothing fires -- basis "none", silent reason, same
      // convention as any other zero-contribution roleScarcity.
      expect(roleScarcity.basis).toBe("none");
      expect(roleScarcity.value).toBe(0);
      expect(reasons.some((r) => r.startsWith("role scarcity:"))).toBe(false);
    });

    it("still applies the curated fallback to a Lever-sourced signal that matches a decision-026 keyword, even though measured is excluded", () => {
      const familyScarcity: FamilyScarcityLookup = {
        globalMedianDaysOpen: 30,
        byFamily: { "data-analytics": { count: 20, medianDaysOpen: 60 } }, // hypothetically eligible, but source excludes it anyway
      };

      const { factors, reasons } = hardToFillScore(
        { ...BASE_SIGNAL, source: "lever", title: "Senior Data Analyst", daysOpen: 60 },
        familyScarcity,
      );

      const roleScarcity = factors.find((f) => f.factor === "roleScarcity")!;
      expect(roleScarcity.basis).toBe("curated");
      expect(roleScarcity.value).toBe(1);
      expect(reasons).toContain("role scarcity: curated (matched decision-026 keyword)");
    });

    it("omitting familyScarcity entirely reproduces the exact pre-S-23 curated-only behavior", () => {
      const withoutLookup = hardToFillScore({ ...BASE_SIGNAL, source: "greenhouse", title: "AI Engineer", daysOpen: 60 });
      const roleScarcity = withoutLookup.factors.find((f) => f.factor === "roleScarcity")!;

      expect(roleScarcity.basis).toBe("curated");
      expect(roleScarcity.value).toBe(1);
    });
  });

  describe("S-24: capacitySignal", () => {
    // Relative to whenever the test actually runs, not a hardcoded absolute
    // date -- stays correct indefinitely instead of quietly rotting once
    // "now" moves far enough past a hardcoded year.
    function monthsAgo(months: number): string {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().slice(0, 10);
    }

    it("weights sum to exactly 1.0 (v3 reweight, 06_decisions/047)", () => {
      const { roleScarcity, daysOpen, repostedRole, capacitySignal } = HARD_TO_FILL_CONFIG.weights;
      expect(roleScarcity + daysOpen + repostedRole + capacitySignal).toBe(1);
    });

    it("stamps the v3 config version", () => {
      const { version } = hardToFillScore(BASE_SIGNAL);
      expect(version).toBe("hard-to-fill-026-v3");
    });

    it("a real alias-table match within the recency window contributes full weight, basis measured", () => {
      const eventDate = monthsAgo(3);
      const lookup: CapacitySignalLookup = {
        rows: [{ source: "h1b-lca", employerNameRaw: "GITLAB INC.", eventDate }],
      };

      const { factors, reasons } = hardToFillScore(
        { ...BASE_SIGNAL, company: "GitLab" },
        undefined,
        lookup,
      );

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      expect(capacitySignal.basis).toBe("measured");
      // 0.2 (weight) * 1 (matchConfidence, alias) * 1.0 (h1b-lca sourceStrength) * 1 (within window)
      expect(capacitySignal.contribution).toBe(0.2);
      expect(capacitySignal.recencyExcluded).toBe(false);
      expect(reasons).toContain(`capacity: H-1B LCA matched (GITLAB INC.), high-confidence, dated ${eventDate}`);
    });

    it("a low-confidence fuzzy match within the window is basis curated, dampened by confidence and sourceStrength", () => {
      const lookup: CapacitySignalLookup = {
        // "GitLab Deutschland GmbH" vs "GitLab" -- 0.5 fuzzy score (companyMatch.test.ts pins this exact number).
        rows: [{ source: "federal-award", employerNameRaw: "GitLab Deutschland GmbH", eventDate: monthsAgo(8) }],
      };

      const { factors, reasons } = hardToFillScore(
        { ...BASE_SIGNAL, company: "GitLab" },
        undefined,
        lookup,
      );

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      expect(capacitySignal.basis).toBe("curated");
      // 0.2 (weight) * 0.5 (matchConfidence) * 0.6 (federal-award sourceStrength) * 1 (within window)
      expect(capacitySignal.contribution).toBeCloseTo(0.06, 5);
      expect(reasons.some((r) => r.includes("low-confidence"))).toBe(true);
    });

    it("a real match OUTSIDE the recency window contributes zero but stays visible, not silently indistinguishable from no match", () => {
      const lookup: CapacitySignalLookup = {
        // Real Step 0 finding: GitLab federal awards from 2016-2017, all
        // stale relative to a 24-month window from any 2026 scoring date.
        rows: [{ source: "federal-award", employerNameRaw: "GITLAB INC.", eventDate: "2016-07-20" }],
      };

      const { factors, reasons } = hardToFillScore(
        { ...BASE_SIGNAL, company: "GitLab" },
        undefined,
        lookup,
      );

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      // Real match, real basis -- NOT "none" -- but zero contribution.
      expect(capacitySignal.basis).toBe("measured");
      expect(capacitySignal.contribution).toBe(0);
      expect(capacitySignal.recencyExcluded).toBe(true);
      expect(capacitySignal.matchedEmployerName).toBe("GITLAB INC.");
      expect(reasons.some((r) => r.includes("excluded") && r.includes("2016-07-20"))).toBe(true);
    });

    it("no matching company at all is basis none, silent reason, same convention as roleScarcity", () => {
      const lookup: CapacitySignalLookup = {
        rows: [{ source: "h1b-lca", employerNameRaw: "Totally Unrelated Co", eventDate: monthsAgo(8) }],
      };

      const { factors, reasons } = hardToFillScore({ ...BASE_SIGNAL, company: "GitLab" }, undefined, lookup);

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      expect(capacitySignal.basis).toBe("none");
      expect(capacitySignal.contribution).toBe(0);
      expect(reasons.some((r) => r.startsWith("capacity:"))).toBe(false);
    });

    it("a below-drop-threshold match (0.33, unaliased 'b v') is treated identically to no match -- basis none, no evidence exposed", () => {
      // The exact naive-Jaccard case Step 0 found: without the alias table
      // this would be 0.33, below dropBelowThreshold (0.5). Using an
      // unrelated variant that also scores low to prove the DROP behavior
      // itself (not the alias table, which companyMatch.test.ts already
      // pins separately).
      const lookup: CapacitySignalLookup = {
        rows: [{ source: "form-d", employerNameRaw: "GitLab Something Else Entirely Corp", eventDate: monthsAgo(8) }],
      };

      const { factors } = hardToFillScore({ ...BASE_SIGNAL, company: "GitLab" }, undefined, lookup);

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      expect(capacitySignal.basis).toBe("none");
      expect(capacitySignal.matchedEmployerName).toBeUndefined();
      expect(capacitySignal.contribution).toBe(0);
    });

    it("omitting capacitySignalLookup entirely (every pre-S-24 caller/test) keeps capacitySignal at basis none, contribution 0", () => {
      const { factors } = hardToFillScore({ ...BASE_SIGNAL, title: "Data Engineer", daysOpen: 30, isRepost: true });

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      expect(capacitySignal.basis).toBe("none");
      expect(capacitySignal.contribution).toBe(0);
    });

    it("picks the best-scoring match across multiple raw_capacity_signals rows, not just the first", () => {
      const lookup: CapacitySignalLookup = {
        rows: [
          { source: "form-d", employerNameRaw: "Unrelated Co", eventDate: monthsAgo(8) },
          { source: "h1b-lca", employerNameRaw: "GITLAB INC.", eventDate: monthsAgo(3) }, // real alias, best
        ],
      };

      const { factors } = hardToFillScore({ ...BASE_SIGNAL, company: "GitLab" }, undefined, lookup);

      const capacitySignal = factors.find((f) => f.factor === "capacitySignal")!;
      expect(capacitySignal.basis).toBe("measured");
      expect(capacitySignal.capacitySource).toBe("h1b-lca");
    });
  });
});
