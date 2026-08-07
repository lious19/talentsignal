import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeRecommendationPool } from "./helpers/fakeRecommendationPool";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

/**
 * TRUST (S-14): "a sales user requests another user's resource... denied
 * unless they own it or are admin." 06_decisions/022 explains why the
 * substantive case here is recruiter-vs-recruiter, not sales — sales has no
 * access to this table at all, so that case is a trivial role denial,
 * covered too but not the interesting part.
 */
describe("GET /api/recommendation-engine/feedback — ownership trust scenario", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a recruiter sees their own feedback by default (no recruiterId param)", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-2"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });
    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-4"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "bad" });

    const res = await request(app)
      .get(`/api/recommendation-engine/feedback?jobId=${job.id}`)
      .set("Authorization", recruiterAuthHeader("user-2"));

    expect(res.status).toBe(200);
    expect(res.body.feedback).toHaveLength(1);
    expect(res.body.feedback[0].recruiterId).toBe("user-2");
    expect(res.body.feedback[0].feedback).toBe("good");
  });

  it("a recruiter explicitly requesting ANOTHER recruiter's feedback is denied (403), and it's logged", async () => {
    const lines = captureStdout();
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-2"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });

    const res = await request(app)
      .get(`/api/recommendation-engine/feedback?jobId=${job.id}&recruiterId=user-2`)
      .set("Authorization", recruiterAuthHeader("user-4"));

    expect(res.status).toBe(403);

    const fullOutput = lines.join("");
    expect(fullOutput).toContain("access denied — ownership");
    expect(fullOutput).toContain("user-4");
  });

  it("admin may view any recruiter's feedback by passing recruiterId", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-2"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });

    const res = await request(app)
      .get(`/api/recommendation-engine/feedback?jobId=${job.id}&recruiterId=user-2`)
      .set("Authorization", adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.feedback).toHaveLength(1);
    expect(res.body.feedback[0].recruiterId).toBe("user-2");
  });

  it("admin omitting recruiterId sees every recruiter's feedback for the job", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const candidate = seedCandidate({ skills: [] });
    const app = createApp(pool, noopProvider);

    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-2"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "good" });
    await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader("user-4"))
      .send({ jobId: job.id, candidateId: candidate.id, feedback: "bad" });

    const res = await request(app)
      .get(`/api/recommendation-engine/feedback?jobId=${job.id}`)
      .set("Authorization", adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.feedback.map((f: { recruiterId: string }) => f.recruiterId).sort()).toEqual([
      "user-2",
      "user-4",
    ]);
  });

  // The trivial case per 06_decisions/022's own honesty note: sales has no
  // access to this route at all, denied by the role gate before ownership
  // is ever evaluated.
  it("rejects a sales role with 403 before ownership is even considered", async () => {
    const { pool, seedJobOpening } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get(`/api/recommendation-engine/feedback?jobId=${job.id}`)
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool, seedJobOpening } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const res = await request(app).get(`/api/recommendation-engine/feedback?jobId=${job.id}`);

    expect(res.status).toBe(401);
  });

  it("returns 400 when jobId is missing", async () => {
    const { pool } = createFakeRecommendationPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/recommendation-engine/feedback")
      .set("Authorization", recruiterAuthHeader());

    expect(res.status).toBe(400);
  });

  it("returns 404 for a job that does not exist", async () => {
    const { pool } = createFakeRecommendationPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/recommendation-engine/feedback?jobId=does-not-exist")
      .set("Authorization", recruiterAuthHeader());

    expect(res.status).toBe(404);
  });
});
