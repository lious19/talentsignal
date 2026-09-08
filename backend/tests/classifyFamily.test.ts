import { describe, expect, it } from "vitest";
import { classifyFamily } from "../src/scoring/hardToFillScore";

describe("classifyFamily (S-23)", () => {
  it("classifies a Staff ML Engineer and a Help Desk Analyst into different families", () => {
    expect(classifyFamily("Staff ML Engineer")).toBe("ml-ai");
    expect(classifyFamily("Help Desk Analyst")).toBe("support-cs");
    expect(classifyFamily("Staff ML Engineer")).not.toBe(classifyFamily("Help Desk Analyst"));
  });

  it("classifies each configured family from a representative real-world title", () => {
    expect(classifyFamily("Senior Backend Engineer (Go)")).toBe("engineering-swe");
    expect(classifyFamily("AI Engineer")).toBe("ml-ai");
    expect(classifyFamily("Senior Data Analyst")).toBe("data-analytics");
    expect(classifyFamily("Security Engineer")).toBe("security");
    expect(classifyFamily("Cloud Architect")).toBe("cloud-infra");
    expect(classifyFamily("Customer Success Manager")).toBe("support-cs");
    expect(classifyFamily("Commercial Account Executive")).toBe("sales-bizdev");
    expect(classifyFamily("Store Associate")).toBe("retail-ops");
  });

  it("falls back to general-other for a title matching no family (e.g. a leadership title, deliberately out of scope for S-23)", () => {
    expect(classifyFamily("Director, Engineering, Platform Operations & Productivity")).toBe("general-other");
    expect(classifyFamily("Chief of Staff, CRO")).toBe("general-other");
  });

  it("is punctuation-tolerant, matching the same word-boundary fix as the decision-026 fallback list", () => {
    expect(classifyFamily("Sr. Data-Analyst")).toBe("data-analytics");
  });

  it("is graceful on empty and whitespace-only titles", () => {
    expect(classifyFamily("")).toBe("general-other");
    expect(classifyFamily("   ")).toBe("general-other");
  });

  describe("precedence: specific (multi-word) keyword beats broad (single-word) keyword", () => {
    it("classifies a title with both a broad ml-ai token and a specific data-analytics phrase as data-analytics", () => {
      // "ai" (ml-ai, broad) is declared before data-analytics, but "data engineer"
      // (specific) must still win — this is the exact collision the two-pass
      // precedence rule exists to prevent.
      expect(classifyFamily("AI Data Engineer")).toBe("data-analytics");
      expect(classifyFamily("Senior Data Scientist, AI Platform")).toBe("data-analytics");
    });

    it("falls back to broad-token, declaration-order precedence only when no specific keyword matches anywhere", () => {
      // Neither "ai" nor "security" is part of any multi-word keyword here,
      // so both are broad tokens; ml-ai is declared before security.
      expect(classifyFamily("AI Security Analyst")).toBe("ml-ai");
    });

    it("does not let an unrelated broad token override a real specific-phrase match", () => {
      // Contains security's broad "security" token, but "cloud engineer" is
      // not a substring here ("security" sits between "cloud" and
      // "engineer"), so this should resolve via the security broad token,
      // not accidentally via cloud-infra.
      expect(classifyFamily("Senior Cloud Security Engineer")).toBe("security");
    });
  });
});
