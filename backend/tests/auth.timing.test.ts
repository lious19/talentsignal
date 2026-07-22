import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";

/**
 * Verifies the timing-parity defense described in routes/auth.ts (always
 * bcrypt.compare against DUMMY_HASH, even for an unknown email). Wall-clock
 * assertions are inherently noisy on a shared CI runner — a loaded box can
 * blow any tolerance tight enough to be meaningful — so this is opt-in only
 * (RUN_TIMING_TESTS=1) and never part of the default `npm test` / CI run.
 * The behavioral guarantee that actually blocks CI is the identical-response
 * assertion in auth.login.test.ts; this is a supplementary, manual check.
 */
const describeIfRequested = process.env.RUN_TIMING_TESTS === "1" ? describe : describe.skip;

describeIfRequested("login timing parity (opt-in, not part of CI)", () => {
  it("an unknown email takes roughly as long as a wrong password", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool);
    await request(app)
      .post("/auth/register")
      .send({ email: "timing-test@example.com", password: "correct-horse-battery" });

    const time = async (email: string, password: string) => {
      const startedAt = process.hrtime.bigint();
      await request(app).post("/auth/login").send({ email, password });
      return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    };

    const wrongPasswordMs = await time("timing-test@example.com", "not-the-right-password");
    const unknownEmailMs = await time("nobody-registered-this@example.com", "whatever-1");

    // Generously wide on purpose — this only needs to catch the dummy-hash
    // compare being removed entirely (which would make the unknown-email
    // path near-instant), not measure precise parity.
    const ratio = Math.max(wrongPasswordMs, unknownEmailMs) / Math.min(wrongPasswordMs, unknownEmailMs);
    expect(ratio).toBeLessThan(5);
  });
});
