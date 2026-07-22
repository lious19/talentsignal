import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";

describe("auth rate limiting", () => {
  it("returns 429 after 10 attempts against /auth/login within the window", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool);
    const attempt = () =>
      request(app)
        .post("/auth/login")
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
    const app = createApp(pool);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });
});
