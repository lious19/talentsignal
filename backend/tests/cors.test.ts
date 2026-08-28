import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";
import { noopProvider } from "./helpers/noopProvider";

function fakePool(): Pool {
  return { query: async () => ({ rows: [{ "?column?": 1 }] }) } as unknown as Pool;
}

function preflight(app: ReturnType<typeof createApp>, origin: string) {
  return request(app)
    .options("/api/health")
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "GET");
}

describe("CORS_ORIGIN allowlist (decision 034)", () => {
  afterEach(() => {
    delete process.env.CORS_ORIGIN;
  });

  it("matches all three configured origins on a comma-separated CORS_ORIGIN", async () => {
    process.env.CORS_ORIGIN =
      "https://a.com,https://b.com,https://c.com";
    const app = createApp(fakePool(), noopProvider);

    const resA = await preflight(app, "https://a.com");
    const resB = await preflight(app, "https://b.com");
    const resC = await preflight(app, "https://c.com");

    expect(resA.headers["access-control-allow-origin"]).toBe("https://a.com");
    expect(resB.headers["access-control-allow-origin"]).toBe("https://b.com");
    expect(resC.headers["access-control-allow-origin"]).toBe("https://c.com");
  });

  it("rejects an origin not on the allowlist", async () => {
    process.env.CORS_ORIGIN =
      "https://a.com,https://b.com,https://c.com";
    const app = createApp(fakePool(), noopProvider);

    const res = await preflight(app, "https://evil.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("trims whitespace around commas in CORS_ORIGIN", async () => {
    process.env.CORS_ORIGIN = "https://a.com , https://b.com";
    const app = createApp(fakePool(), noopProvider);

    const resA = await preflight(app, "https://a.com");
    const resB = await preflight(app, "https://b.com");

    expect(resA.headers["access-control-allow-origin"]).toBe("https://a.com");
    expect(resB.headers["access-control-allow-origin"]).toBe("https://b.com");
  });

  it("rejects every origin when CORS_ORIGIN is an empty string", async () => {
    process.env.CORS_ORIGIN = "";
    const app = createApp(fakePool(), noopProvider);

    const res = await preflight(app, "https://a.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows any origin when CORS_ORIGIN is unset (local-dev default)", async () => {
    delete process.env.CORS_ORIGIN;
    const app = createApp(fakePool(), noopProvider);

    const res = await preflight(app, "https://anything.example");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
