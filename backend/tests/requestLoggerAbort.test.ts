import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requestLogger } from "../src/middleware/requestLogger";

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

function parseLogLines(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * A minimal stand-in for Express's `res` — just the EventEmitter surface and
 * two properties requestLogger actually reads (statusCode, writableEnded).
 * A real aborted request needs a real client that destroys its socket
 * mid-response, which is slow and timing-dependent to drive from a test.
 * Firing "close" directly on a fake response, without ever firing "finish",
 * reproduces exactly the same shape of event requestLogger has to handle,
 * deterministically.
 */
class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableEnded = false;
  setHeader = vi.fn();
}

function fakeReq(): Request {
  return {
    header: () => undefined,
    originalUrl: "/slow",
    method: "GET",
  } as unknown as Request;
}

describe("requestLogger — client disconnects mid-request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a 'request aborted' line when close fires without finish", () => {
    const lines = captureStdout();
    const res = new FakeResponse();
    const next = vi.fn();

    requestLogger(fakeReq(), res as unknown as Response, next as NextFunction);

    // writableEnded is still false: res.end() was never called, which is
    // what a genuinely aborted connection looks like.
    res.emit("close");

    const [entry] = parseLogLines(lines);
    expect(entry.msg).toBe("request aborted");
    expect(entry.aborted).toBe(true);
    expect(next).toHaveBeenCalledOnce();
  });

  it("emits exactly one log line even if both finish and close fire", () => {
    const lines = captureStdout();
    const res = new FakeResponse();
    const next = vi.fn();

    requestLogger(fakeReq(), res as unknown as Response, next as NextFunction);

    res.writableEnded = true; // res.end() was called: a normal completion
    res.emit("finish");
    res.emit("close"); // per Node's docs, close still fires afterward

    const entries = parseLogLines(lines);
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe("request completed");
    expect(entries[0].aborted).toBe(false);
  });

  it("emits exactly one log line if close fires before finish somehow does", () => {
    const lines = captureStdout();
    const res = new FakeResponse();
    const next = vi.fn();

    requestLogger(fakeReq(), res as unknown as Response, next as NextFunction);

    res.emit("close"); // aborted: true, since writableEnded is still false
    res.writableEnded = true;
    res.emit("finish"); // must not produce a second line

    const entries = parseLogLines(lines);
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe("request aborted");
  });
});
