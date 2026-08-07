import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeRecommendationPool } from "./helpers/fakeRecommendationPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader, recruiterAuthHeader } from "./helpers/authHeader";

describe("POST /api/recommendation-engine/feedback", () => {
  it("happy path: records feedback with the authenticated user as recruiterId", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });

    expect(res.status).toBe(200);
    expect(res.body.feedback.feedback).toBe("good");
    // recruiterAuthHeader signs sub "user-2" by default — see tests/helpers/authHeader.ts.
    expect(res.body.feedback.recruiterId).toBe("user-2");
  });

  it("idempotency: marking the same recommendation 'good' twice stays one row", async () => {
    const { pool, seedJobOpening, seedCandidate, feedback } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });
    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });

    expect(feedback).toHaveLength(1);
    expect(feedback[0].feedback).toBe("good");
  });

  it("reversible: marking 'bad' after 'good' flips the SAME row, not a second one", async () => {
    const { pool, seedJobOpening, seedCandidate, feedback } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });
    const second = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "bad" });

    expect(second.status).toBe(200);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].feedback).toBe("bad");
  });

  it("keys feedback by recruiter: two recruiters marking the same recommendation get two rows", async () => {
    const { pool, seedJobOpening, seedCandidate, feedback } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });
    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-4"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "bad" });

    expect(feedback).toHaveLength(2);
    expect(feedback.map((f) => f.recruiter_id).sort()).toEqual(["user-2", "user-4"]);
  });

  it("returns 400 for an invalid feedback value", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "excellent" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a job that does not exist", async () => {
    const { pool, seedCandidate } = createFakeRecommendationPool();
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: "does-not-exist", candidateId: candidate.id, feedback: "good" });

    expect(res.status).toBe(404);
  });

  it("400s a foreign-key violation for an unknown candidate", async () => {
    const { pool, seedJobOpening } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id, candidateId: "does-not-exist", feedback: "good" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("candidate not found");
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeRecommendationPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/recommendation-engine/feedback")
      .send({ jobId: "job-1", candidateId: "candidate-1", feedback: "good" });

    expect(res.status).toBe(401);
  });

  // 06_decisions/022: admin/recruiter only (S-11: "As a recruiter...").
  it("rejects a sales role with 403 (06_decisions/022)", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });

    expect(res.status).toBe(403);
  });
});
