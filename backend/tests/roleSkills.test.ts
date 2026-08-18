import { describe, expect, it } from "vitest";
import { ROLE_SKILLS, requirementsForTitle } from "../src/matching/roleSkillsConfig";
import { HARD_TO_FILL_CONFIG } from "../src/scoring/hardToFillConfig";

describe("requirementsForTitle (HF-3 role -> skills bridge, 06_decisions/027)", () => {
  it("maps a data-analyst title to its role type and skills", () => {
    const { roleType, requirements } = requirementsForTitle("Senior Data Analyst");
    expect(roleType).toBe("data analyst");
    expect(requirements).toEqual(expect.arrayContaining(["sql", "python"]));
  });

  it("matches case-insensitively and as a substring, like HF-1", () => {
    const { roleType } = requirementsForTitle("STAFF ML ENGINEER - Applied Group");
    expect(roleType).toBe("ml engineer");
  });

  it("returns null role and no requirements for a title matching no scarce role", () => {
    const { roleType, requirements } = requirementsForTitle("Senior Recruiter");
    expect(roleType).toBeNull();
    expect(requirements).toEqual([]);
  });

  it("inherits HF-1's punctuation-sensitive limitation (Sr. Data-Analyst does not match)", () => {
    const { roleType } = requirementsForTitle("Sr. Data-Analyst");
    expect(roleType).toBeNull();
  });

  it("has a skills entry for EVERY hard-to-fill role keyword (no unmatched role)", () => {
    for (const keyword of HARD_TO_FILL_CONFIG.roleKeywords) {
      expect(ROLE_SKILLS[keyword], `missing ROLE_SKILLS for "${keyword}"`).toBeDefined();
      expect(ROLE_SKILLS[keyword].length).toBeGreaterThan(0);
    }
  });
});
