import { describe, expect, it } from "vitest";
import { scoreCandidate } from "../src/matching/matchScore";

describe("scoreCandidate", () => {
  it("scores full skill overlap at skillsScore 1 and weights it fully", () => {
    const result = scoreCandidate(
      { skills: ["react", "sql"], experience: 0 },
      { requirements: ["react", "sql"] },
    );

    expect(result.skillsScore).toBe(1);
    expect(result.fitScore).toBeCloseTo(0.7, 5);
    expect(result.matchedSkills.sort()).toEqual(["react", "sql"]);
    expect(result.rankDriver).toBe("skills-only");
  });

  it("scores partial overlap via the cosine (Ochiai) formula", () => {
    // 4 candidate skills, 3 job requirements, intersection size 2:
    // skillsScore = 2 / sqrt(4*3) = 0.577
    const result = scoreCandidate(
      { skills: ["react", "node", "sql", "python"], experience: 6 },
      { requirements: ["react", "typescript", "sql"] },
    );

    expect(result.skillsScore).toBeCloseTo(0.577, 3);
    expect(result.experienceScore).toBeCloseTo(0.6, 5);
    expect(result.skillsContribution).toBeCloseTo(0.404, 3);
    expect(result.experienceContribution).toBeCloseTo(0.104, 3);
    expect(result.fitScore).toBeCloseTo(0.508, 3);
    expect(result.matchedSkills.sort()).toEqual(["react", "sql"]);
    expect(result.rankDriver).toBe("skills-plus-experience");
  });

  it("scores zero overlap at exactly 0, regardless of experience", () => {
    const result = scoreCandidate(
      { skills: ["cobol"], experience: 20 },
      { requirements: ["react"] },
    );

    expect(result.skillsScore).toBe(0);
    expect(result.fitScore).toBe(0);
    expect(result.matchedSkills).toEqual([]);
    expect(result.rankDriver).toBe("no-skill-match");
  });

  it("guards the ranking-inversion fix: zero skill overlap never outranks a weak real match", () => {
    // Zero overlap, max experience.
    const zeroOverlapHighExperience = scoreCandidate(
      { skills: ["cobol"], experience: 10 },
      { requirements: ["react"] },
    );
    // Weak overlap (1 of 5), minimal experience.
    const weakOverlapLowExperience = scoreCandidate(
      { skills: ["a", "b", "c", "d", "e"], experience: 1 },
      { requirements: ["a", "x", "y", "z", "w"] },
    );

    expect(zeroOverlapHighExperience.fitScore).toBe(0);
    expect(weakOverlapLowExperience.fitScore).toBeGreaterThan(zeroOverlapHighExperience.fitScore);
  });

  it("treats an empty requirements list as zero overlap, with a reason naming why", () => {
    const result = scoreCandidate({ skills: ["react"], experience: 5 }, { requirements: [] });

    expect(result.skillsScore).toBe(0);
    expect(result.fitScore).toBe(0);
    expect(result.reasons).toContain("job has no listed requirements");
  });

  it("treats an empty skills list as zero overlap, with a reason naming why", () => {
    const result = scoreCandidate({ skills: [], experience: 0 }, { requirements: ["react"] });

    expect(result.skillsScore).toBe(0);
    expect(result.reasons).toContain("candidate has no listed skills");
  });

  it("matches skills case-insensitively but reports the candidate's original casing", () => {
    const result = scoreCandidate(
      { skills: ["React", "SQL"], experience: 0 },
      { requirements: ["react", "sql"] },
    );

    expect(result.skillsScore).toBe(1);
    expect(result.matchedSkills.sort()).toEqual(["React", "SQL"]);
  });

  it("saturates the experience contribution at the configured cap", () => {
    const atCap = scoreCandidate({ skills: ["react"], experience: 10 }, { requirements: ["react"] });
    const overCap = scoreCandidate({ skills: ["react"], experience: 25 }, { requirements: ["react"] });

    expect(atCap.experienceScore).toBe(1);
    expect(overCap.experienceScore).toBe(1);
    expect(atCap.fitScore).toBeCloseTo(overCap.fitScore, 5);
  });

  it("labels rankDriver skills-only when there is overlap but no experience", () => {
    const result = scoreCandidate({ skills: ["react"], experience: 0 }, { requirements: ["react"] });
    expect(result.rankDriver).toBe("skills-only");
  });

  it("labels rankDriver skills-plus-experience when both contributed", () => {
    const result = scoreCandidate({ skills: ["react"], experience: 3 }, { requirements: ["react"] });
    expect(result.rankDriver).toBe("skills-plus-experience");
  });

  it("labels rankDriver no-skill-match when there is no overlap at all", () => {
    const result = scoreCandidate({ skills: ["cobol"], experience: 3 }, { requirements: ["react"] });
    expect(result.rankDriver).toBe("no-skill-match");
  });

  it("is deterministic: same candidate + same job always produce the same result", () => {
    const candidate = { skills: ["react", "sql"], experience: 4 };
    const job = { requirements: ["react", "node"] };

    const first = scoreCandidate(candidate, job);
    const second = scoreCandidate(candidate, job);

    expect(second).toEqual(first);
  });
});
