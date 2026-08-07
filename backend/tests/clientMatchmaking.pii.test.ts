import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeMatchmakingPool } from "./helpers/fakeMatchmakingPool";
import { noopProvider } from "./helpers/noopProvider";
import { adminAuthHeader, recruiterAuthHeader, salesAuthHeader } from "./helpers/authHeader";

/**
 * S-06 reads candidates through a new path (clientMatchmakingRouter), so it
 * must honor S-05's PII rule independently of candidates.ts — a match
 * response's job is ranking, not contact lookup, so contact_info must never
 * appear here, for any role that can reach it, unlike GET /candidates which
 * shows it to admin/recruiter (06_decisions/009). This locks that contract
 * in with a test rather than trusting the field list alone.
 *
 * Originally parameterized over all three roles defensively. 06_decisions/022
 * (S-14) later gated this route to admin/sales only (S-06: "As a sales
 * rep...") — recruiter's case here was never evidence that recruiter access
 * was intended, just maximal defensiveness in a PII sweep, so it's replaced
 * below with the now-correct check: recruiter is denied before the PII
 * question is even reached.
 */
describe("PII — contact_info never appears in a client-matchmaking match response", () => {
  const CONTACT_EMAIL = "jordan@example.com";

  it.each([
    ["sales", salesAuthHeader],
    ["admin", adminAuthHeader],
  ])("hides contact_info from a %s-authed match, even though it's populated", async (_role, authHeader) => {
    const { pool, seedJobOpening, seedCandidate } = createFakeMatchmakingPool();
    const job = seedJobOpening({ requirements: ["react"] });
    seedCandidate({
      name: "Jordan Rivera",
      skills: ["react"],
      experience: 5,
      contact_info: { email: CONTACT_EMAIL, phone: "555-0100" },
    });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", authHeader())
      .send({ jobId: job.id });

    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0]).not.toHaveProperty("contactInfo");
    expect(res.body.candidates[0]).not.toHaveProperty("contact_info");

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("contactInfo");
    expect(serialized).not.toContain("contact_info");
    expect(serialized).not.toContain(CONTACT_EMAIL);
    expect(serialized).not.toContain("555-0100");
  });

  it("denies a recruiter-authed request with 403 before the PII question is even reached (06_decisions/022)", async () => {
    const { pool, seedJobOpening } = createFakeMatchmakingPool();
    const job = seedJobOpening({ requirements: ["react"] });
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", recruiterAuthHeader())
      .send({ jobId: job.id });

    expect(res.status).toBe(403);
  });
});
