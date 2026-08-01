import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeRecommendationPool } from "./helpers/fakeRecommendationPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-11, REQ-020): "feedback is stored against the recommendation."
 * Recommendations are computed on the fly — there's no persisted
 * recommendation row — so this proves the mark lands on the specific
 * (job, candidate, recruiter) triple it was made against, not globally or
 * on the wrong candidate.
 */
describe("TRUST — feedback is stored against the specific recommendation it was given for", () => {
  it("marking one candidate 'good' leaves every other candidate 'none', keyed correctly on re-fetch", async () => {
    const { pool, seedJobOpening, seedCandidate } = createFakeRecommendationPool();
    const job = seedJobOpening({ requirements: ["react", "sql"] });
    const target = seedCandidate({ name: "Full Overlap", skills: ["react", "sql"], experience: 2 });
    seedCandidate({ name: "Partial Overlap", skills: ["react"], experience: 0 });
    seedCandidate({ name: "No Overlap", skills: ["cobol"], experience: 10 });
    const app = createApp(pool, noopProvider);

    const before = await request(app)
      .post("/api/recommendation-engine/recommend")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });
    expect(before.body.candidates.every((c: { feedback: string }) => c.feedback === "none")).toBe(true);

    const feedbackRes = await request(app)
      .post("/api/recommendation-engine/feedback")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id, candidateId: target.id, feedback: "good" });
    expect(feedbackRes.status).toBe(200);

    const after = await request(app)
      .post("/api/recommendation-engine/recommend")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });

    const byId = new Map(
      after.body.candidates.map((c: { id: string; feedback: string }) => [c.id, c.feedback]),
    );
    expect(byId.get(target.id)).toBe("good");
    for (const candidate of after.body.candidates) {
      if (candidate.id !== target.id) expect(candidate.feedback).toBe("none");
    }
  });
});
