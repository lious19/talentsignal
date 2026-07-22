import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";

function fakePool(queryImpl: () => Promise<unknown>): Pool {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

describe("GET /health", () => {
  it("returns 200 ok when the database responds (happy path)", async () => {
    const pool = fakePool(async () => ({ rows: [{ "?column?": 1 }] }));
    const app = createApp(pool);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unreachable (failure path)", async () => {
    const pool = fakePool(async () => {
      throw new Error("connection refused");
    });
    const app = createApp(pool);

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", db: "unreachable" });
  });
});
