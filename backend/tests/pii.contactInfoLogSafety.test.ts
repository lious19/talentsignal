import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeCandidatesPool } from "./helpers/fakeCandidatesPool";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader } from "./helpers/authHeader";
import { logger } from "../src/logger";

const DISTINCTIVE_EMAIL = "do-not-leak-me-a1b2c3@example.com";
const DISTINCTIVE_PHONE = "+1-555-010-9999";

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

describe("extends S-02's log-safety pattern to candidate contact_info", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a candidate's raw email/phone never appears in stdout during create + read (full-text scan)", async () => {
    const lines = captureStdout();
    const { pool } = createFakeCandidatesPool();
    const app = createApp(pool, noopProvider);
    const auth = recruiterAuthHeader();

    const create = await request(app)
      .post("/api/candidates")
      .set("Authorization", auth)
      .send({
        name: "Jordan Rivera",
        contactInfo: { email: DISTINCTIVE_EMAIL, phone: DISTINCTIVE_PHONE },
      });
    await request(app).get(`/api/candidates/${create.body.id}`).set("Authorization", auth);

    const fullOutput = lines.join("");
    expect(fullOutput).not.toContain(DISTINCTIVE_EMAIL);
    expect(fullOutput).not.toContain(DISTINCTIVE_PHONE);
  });

  it("redacts contactInfo wherever it appears in a logged object (the safety net)", () => {
    const lines = captureStdout();

    logger.info(
      { candidate: { name: "Jordan Rivera", contactInfo: { email: DISTINCTIVE_EMAIL } } },
      "test event",
    );
    logger.info({ contact_info: { phone: DISTINCTIVE_PHONE } }, "another test event");

    const fullOutput = lines.join("");
    expect(fullOutput).not.toContain(DISTINCTIVE_EMAIL);
    expect(fullOutput).not.toContain(DISTINCTIVE_PHONE);
    expect(fullOutput).toContain("[Redacted]");
  });
});
