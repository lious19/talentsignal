import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";
import { createFakeTargetingPool } from "./helpers/fakeTargetingPool";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

// A flagged data-analyst opening (score 1.0) plus students with varying skill
// overlap against the data-analyst role skills (sql, python, data
// visualization, statistics, excel — see roleSkillsConfig.ts).
function seedDataAnalystScenario() {
  const fake = createFakeTargetingPool();
  fake.seedOpportunity({
    company: "Insight Analytics",
    title: "Senior Data Analyst",
    hard_to_fill_score: "1",
    hard_to_fill_reasons: ["in-demand role type", "open 30 days", "reposted role"],
  });
  fake.seedCandidate({ name: "Strong Match", skills: ["sql", "python", "statistics"], experience: 3 });
  fake.seedCandidate({ name: "Weak Match", skills: ["excel"], experience: 1 });
  fake.seedCandidate({ name: "No Match", skills: ["cobol"], experience: 10 });
  return fake;
}

describe("GET /api/hard-to-fill/targeting", () => {
  it("pairs a hard-to-fill role with students ranked by fit, each with a reason (advisory)", async () => {
    const { pool } = seedDataAnalystScenario();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/hard-to-fill/targeting")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBe(true);
    expect(res.body.targets).toHaveLength(1);

    const target = res.body.targets[0];
    expect(target.company).toBe("Insight Analytics");
    expect(target.title).toBe("Senior Data Analyst");
    expect(target.roleType).toBe("data analyst");
    expect(target.requirements).toEqual(expect.arrayContaining(["sql", "python"]));
    // The flag carries its reason through to the targeting view too.
    expect(target.hardToFillReasons).toEqual(expect.arrayContaining(["in-demand role type"]));

    const names = target.students.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Strong Match", "Weak Match", "No Match"]);
    // Never a bare score: each student carries the matched skills + reasons.
    expect(target.students[0].matchedSkills).toEqual(expect.arrayContaining(["sql", "python"]));
    expect(target.students[0].reasons.length).toBeGreaterThan(0);
    // A candidate with zero matching skills can never outrank a real overlap.
    expect(target.students[2].fitScore).toBe(0);
  });

  it("lists only flagged roles — an opportunity below the threshold is excluded", async () => {
    const fake = createFakeTargetingPool();
    fake.seedOpportunity({ company: "Acme Corp", title: "Senior Recruiter", hard_to_fill_score: "0.36" });
    fake.seedCandidate({ name: "Someone", skills: ["sql"], experience: 2 });
    const app = createApp(fake.pool, noopProvider);

    const res = await request(app)
      .get("/api/hard-to-fill/targeting")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.targets).toHaveLength(0);
  });

  it("TRUST: is read-only — it never issues a write, so nothing is submitted automatically", async () => {
    const fake = seedDataAnalystScenario();
    const app = createApp(fake.pool, noopProvider);

    await request(app).get("/api/hard-to-fill/targeting").set("Authorization", salesAuthHeader());

    const statements = fake.queryFn.mock.calls.map(([sql]) => String(sql).trim().toUpperCase());
    expect(statements.length).toBeGreaterThan(0);
    for (const sql of statements) {
      expect(sql.startsWith("SELECT")).toBe(true);
      expect(/\b(INSERT|UPDATE|DELETE)\b/.test(sql)).toBe(false);
    }
  });

  it("idempotency: two calls over the same data return an identical ranking", async () => {
    const { pool } = seedDataAnalystScenario();
    const app = createApp(pool, noopProvider);

    const first = await request(app).get("/api/hard-to-fill/targeting").set("Authorization", salesAuthHeader());
    const second = await request(app).get("/api/hard-to-fill/targeting").set("Authorization", salesAuthHeader());

    expect(second.body).toEqual(first.body);
  });

  it("returns an empty targets list when there are no hard-to-fill opportunities", async () => {
    const fake = createFakeTargetingPool();
    fake.seedCandidate({ name: "Someone", skills: ["sql"], experience: 2 });
    const app = createApp(fake.pool, noopProvider);

    const res = await request(app).get("/api/hard-to-fill/targeting").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.targets).toEqual([]);
  });

  // S-18 / 06_decisions/028: mirrors hiddenDemand.ts's /opportunities opt-in
  // exactly, so load-test/demo runs can see seed-sourced hard-to-fill
  // opportunities at volume without a separate fixture-insert path.
  it("excludes seed-job-board opportunities by default, includes them with ?includeSeedData=true", async () => {
    const fake = createFakeTargetingPool();
    fake.seedOpportunity({
      source: "seed-job-board",
      company: "Seed Co",
      title: "Data Scientist",
      hard_to_fill_score: "1",
    });
    fake.seedCandidate({ name: "Someone", skills: ["sql"], experience: 2 });
    const app = createApp(fake.pool, noopProvider);

    const withoutFlag = await request(app)
      .get("/api/hard-to-fill/targeting")
      .set("Authorization", salesAuthHeader());
    expect(withoutFlag.body.targets).toHaveLength(0);

    const withFlag = await request(app)
      .get("/api/hard-to-fill/targeting?includeSeedData=true")
      .set("Authorization", salesAuthHeader());
    expect(withFlag.body.targets).toHaveLength(1);
    expect(withFlag.body.targets[0].company).toBe("Seed Co");
  });

  // 06_decisions/022: admin/sales only (S-06: "As a sales rep...").
  it("rejects a recruiter role with 403", async () => {
    const { pool } = seedDataAnalystScenario();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/hard-to-fill/targeting")
      .set("Authorization", recruiterAuthHeader());

    expect(res.status).toBe(403);
  });

  it("returns 500 when the database fails", async () => {
    const pool = {
      query: async () => {
        throw new Error("connection lost");
      },
    } as unknown as Pool;
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/hard-to-fill/targeting").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(500);
  });
});
