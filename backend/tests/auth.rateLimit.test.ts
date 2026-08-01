import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";
import { noopProvider } from "./helpers/noopProvider";

describe("auth rate limiting", () => {
  it("returns 429 after 10 attempts against /api/auth/login within the window", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);
    const attempt = () =>
      request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "wrong-password" });

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(await attempt());
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it("uses a fresh counter per app instance, so tests don't bleed into each other", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  // Regression test for the bug reported after S-09's manual smoke test:
  // authRateLimit was mounted via router.use(authRateLimit) with no path
  // filter, and authRouter is itself mounted at the "/api" prefix in app.ts —
  // so the limiter silently applied to every /api/* request, not just
  // login/register. A couple of page reloads could exhaust the whole app's
  // budget. GET /api/clients never touches the pool when unauthenticated
  // (requireAuth 401s first), so this stays 401 on every attempt if scoping
  // is correct — a stray 429 anywhere in the 11 responses means the limiter
  // has leaked outside "/auth" again.
  it("does not rate-limit a non-auth route after 10+ rapid requests", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);
    const attempt = () => request(app).get("/api/clients");

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(await attempt());
    }

    expect(responses.map((r) => r.status)).toEqual(Array(11).fill(401));
  });
});
