import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";

function fakePool(): Pool {
  return { query: vi.fn(async () => ({ rows: [{}] })) } as unknown as Pool;
}

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

function findRequestCompletedLine(lines: string[]): Record<string, unknown> {
  const parsed = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const match = parsed.find((entry) => entry.msg === "request completed");
  if (!match) throw new Error("no 'request completed' log line was emitted");
  return match;
}

describe("requestLogger middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits one JSON line with a correlation id, route, and duration", async () => {
    const lines = captureStdout();
    const app = createApp(fakePool());

    await request(app).get("/health");

    const logLine = findRequestCompletedLine(lines);
    expect(logLine.route).toBe("/health");
    expect(logLine.method).toBe("GET");
    expect(typeof logLine.correlationId).toBe("string");
    expect((logLine.correlationId as string).length).toBeGreaterThan(0);
    expect(typeof logLine.durationMs).toBe("number");
    expect(logLine.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it("honors an inbound X-Correlation-Id header instead of replacing it", async () => {
    const lines = captureStdout();
    const app = createApp(fakePool());

    const res = await request(app)
      .get("/health")
      .set("X-Correlation-Id", "test-fixed-id");

    expect(res.headers["x-correlation-id"]).toBe("test-fixed-id");
    const logLine = findRequestCompletedLine(lines);
    expect(logLine.correlationId).toBe("test-fixed-id");
  });

  it("generates a fresh correlation id when none is supplied", async () => {
    const lines = captureStdout();
    const app = createApp(fakePool());

    const res = await request(app).get("/health");

    const headerId = res.headers["x-correlation-id"];
    expect(headerId).toBeTruthy();
    const logLine = findRequestCompletedLine(lines);
    expect(logLine.correlationId).toBe(headerId);
  });
});
