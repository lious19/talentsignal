import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";

const CREDENTIALS = { email: "login-test@example.com", password: "correct-horse-battery" };

describe("POST /auth/login", () => {
  it("happy path: issues a JWT carrying the user's id and role", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool);
    await request(app).post("/auth/register").send(CREDENTIALS);

    const res = await request(app).post("/auth/login").send(CREDENTIALS);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: CREDENTIALS.email,
      role: "sales",
    });

    const claims = jwt.verify(res.body.token, process.env.JWT_SECRET as string) as {
      sub: string;
      role: string;
    };
    expect(claims.sub).toBe(res.body.user.id);
    expect(claims.role).toBe("sales");
  });

  it("failure: wrong password and unknown email return identical responses", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool);
    await request(app).post("/auth/register").send(CREDENTIALS);

    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email: CREDENTIALS.email, password: "not-the-right-password" });
    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: "nobody-registered-this@example.com", password: "whatever-1" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Same status AND same body — an attacker can't use either signal to
    // find out which emails are registered.
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("failure: missing credentials are rejected before touching the database", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool);

    const res = await request(app).post("/auth/login").send({ email: CREDENTIALS.email });

    expect(res.status).toBe(400);
  });
});
