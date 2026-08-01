import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";
import { createFakeOpportunityPackagePool } from "./helpers/fakeOpportunityPackagePool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("POST /api/opportunity-package/draft", () => {
  it("happy path: composes a draft flagged AI-generated with the top-ranked candidates", async () => {
    const { pool, seedOpportunity, seedJobOpening, seedCandidate } =
      createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity({ company: "Acme Corp", confidence_score: "0.820" });
    const job = seedJobOpening({ title: "Backend Engineer", requirements: ["react", "sql"] });
    seedCandidate({ name: "No Overlap", skills: ["cobol"], experience: 10 });
    seedCandidate({ name: "Full Overlap", skills: ["react", "sql"], experience: 2 });
    seedCandidate({ name: "Partial Overlap", skills: ["react"], experience: 0 });
    seedCandidate({ name: "Also No Overlap", skills: ["fortran"], experience: 1 });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: opportunity.id, jobOpeningId: job.id });

    expect(res.status).toBe(201);
    const pkg = res.body.package;
    expect(pkg.status).toBe("draft");
    expect(pkg.aiGenerated).toBe(true);
    expect(pkg.releasedBy).toBeNull();
    expect(pkg.releasedAt).toBeNull();
    expect(pkg.content.company).toBe("Acme Corp");
    expect(pkg.content.jobTitle).toBe("Backend Engineer");
    // topCandidateCount = 3 (PACKAGE_CONFIG) — the pool has 4 candidates.
    expect(pkg.candidateIds).toHaveLength(3);
    expect(pkg.content.candidates).toHaveLength(3);
    const names = pkg.content.candidates.map((c: { name: string }) => c.name);
    // Ranked: Full Overlap, then Partial Overlap; the last slot is a 0-fit-score
    // tie between "No Overlap" and "Also No Overlap", broken by id (seed order),
    // which is exactly why "Also No Overlap" is the one cut by the top-3 limit.
    expect(names).toEqual(["Full Overlap", "Partial Overlap", "No Overlap"]);
    expect(names).not.toContain("Also No Overlap");
  });

  it("returns 400 when opportunityId is missing", async () => {
    const { pool, seedJobOpening } = createFakeOpportunityPackagePool();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ jobOpeningId: job.id });

    expect(res.status).toBe(400);
  });

  it("returns 400 when jobOpeningId is missing", async () => {
    const { pool, seedOpportunity } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: opportunity.id });

    expect(res.status).toBe(400);
  });

  it("returns 404 for an opportunity that does not exist", async () => {
    const { pool, seedJobOpening } = createFakeOpportunityPackagePool();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: "does-not-exist", jobOpeningId: job.id });

    expect(res.status).toBe(404);
  });

  it("returns 404 for a job opening that does not exist", async () => {
    const { pool, seedOpportunity } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: opportunity.id, jobOpeningId: "does-not-exist" });

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeOpportunityPackagePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .send({ opportunityId: "o-1", jobOpeningId: "j-1" });

    expect(res.status).toBe(401);
  });

  it("returns 500 when the database fails", async () => {
    const pool = {
      query: async () => {
        throw new Error("connection lost");
      },
    } as unknown as Pool;
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: "o-1", jobOpeningId: "j-1" });

    expect(res.status).toBe(500);
  });
});

describe("GET /api/opportunity-packages", () => {
  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeOpportunityPackagePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/opportunity-packages");

    expect(res.status).toBe(401);
  });

  it("lists drafted packages, newest first", async () => {
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: opportunity.id, jobOpeningId: job.id });

    const res = await request(app)
      .get("/api/opportunity-packages")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.packages).toHaveLength(1);
    expect(res.body.packages[0].status).toBe("draft");
  });
});
