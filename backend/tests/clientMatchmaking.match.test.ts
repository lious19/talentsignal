import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";
import { createFakeMatchmakingPool } from "./helpers/fakeMatchmakingPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("POST /api/client-matchmaking/match", () => {
  it("returns candidates ranked by fit score, most relevant first", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeMatchmakingPool();
    const job = seedJobOpening({ requirements: ["react", "sql"] });
    seedCandidate({ name: "No Overlap", skills: ["cobol"], experience: 10 });
    seedCandidate({ name: "Full Overlap", skills: ["react", "sql"], experience: 2 });
    seedCandidate({ name: "Partial Overlap", skills: ["react"], experience: 0 });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });

    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBe(true);
    expect(res.body.jobId).toBe(job.id);
    const names = res.body.candidates.map((c: { name: string }) => c.name);
    expect(names).toEqual(["Full Overlap", "Partial Overlap", "No Overlap"]);
    expect(res.body.candidates[0].fitScore).toBeGreaterThan(res.body.candidates[1].fitScore);
    expect(res.body.candidates[1].fitScore).toBeGreaterThan(res.body.candidates[2].fitScore);
    expect(res.body.candidates[2].fitScore).toBe(0);
  });

  it("returns 404 for a job that does not exist", async () => {
    const { pool } = createFakeMatchmakingPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: "does-not-exist" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when jobId is missing", async () => {
    const { pool } = createFakeMatchmakingPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 500 when the database fails", async () => {
    const pool = {
      query: async () => {
        throw new Error("connection lost");
      },
    } as unknown as Pool;
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: "job-1" });

    expect(res.status).toBe(500);
  });

  it("is idempotent: the same job + candidate pool produces an identical ranking", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeMatchmakingPool();
    const job = seedJobOpening({ requirements: ["react", "sql", "node"] });
    seedCandidate({ name: "Alex", skills: ["react", "node"], experience: 3 });
    seedCandidate({ name: "Bailey", skills: ["react"], experience: 8 });
    seedCandidate({ name: "Casey", skills: [], experience: 0 });

    const app = createApp(pool, noopProvider);
    const first = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });
    const second = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });

    expect(second.body.candidates).toEqual(first.body.candidates);
  });

  it("never lets a candidate with zero matching skills outrank one with a real overlap", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeMatchmakingPool();
    const job = seedJobOpening({ requirements: ["a", "x", "y", "z", "w"] });
    seedCandidate({ name: "Zero Overlap, High Experience", skills: ["cobol"], experience: 10 });
    seedCandidate({ name: "Weak Overlap, Low Experience", skills: ["a", "b", "c", "d", "e"], experience: 1 });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });

    expect(res.status).toBe(200);
    expect(res.body.candidates[0].name).toBe("Weak Overlap, Low Experience");
    expect(res.body.candidates[1].name).toBe("Zero Overlap, High Experience");
    expect(res.body.candidates[1].fitScore).toBe(0);
  });
});
