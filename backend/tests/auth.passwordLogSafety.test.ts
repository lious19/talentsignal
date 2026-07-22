import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";
import { logger } from "../src/logger";

const RAW_PASSWORD = "S3cretTestPassphrase-do-not-leak-me";

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

describe("trust scenario: the raw password never reaches the logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not appear anywhere in stdout during register + login (full-text scan, not field-by-field)", async () => {
    const lines = captureStdout();
    const { pool } = createFakeUsersPool();
    const app = createApp(pool);

    await request(app)
      .post("/auth/register")
      .send({ email: "log-safety@example.com", password: RAW_PASSWORD });
    await request(app)
      .post("/auth/login")
      .send({ email: "log-safety@example.com", password: RAW_PASSWORD });
    // A failed login carries the raw password through the request/response
    // cycle too — worth covering, since the trust scenario is about anything
    // that "persists a user," and a login attempt against that same account
    // still runs the same code paths.
    await request(app)
      .post("/auth/login")
      .send({ email: "log-safety@example.com", password: "wrong-" + RAW_PASSWORD });

    const fullOutput = lines.join("");
    expect(fullOutput).not.toContain(RAW_PASSWORD);
  });

  it("redacts a password field wherever it appears in a logged object (the safety net)", () => {
    const lines = captureStdout();

    logger.info({ user: { email: "x@example.com", password: RAW_PASSWORD } }, "test event");
    logger.info({ password_hash: RAW_PASSWORD }, "another test event");

    const fullOutput = lines.join("");
    expect(fullOutput).not.toContain(RAW_PASSWORD);
    expect(fullOutput).toContain("[Redacted]");
  });
});
