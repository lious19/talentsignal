import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";
import { createFakeAnalyticsPool } from "./helpers/fakeAnalyticsPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("GET /api/analytics — empty data", () => {
  it("returns zeros/nulls, not a crash, when there are no pipelines or opportunities", async () => {
    const { pool } = createFakeAnalyticsPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/analytics").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.placementsPerMonth).toEqual([]);
    expect(res.body.timeToHire).toEqual({ averageDays: null, sampleSize: 0 });
    expect(res.body.demandScore).toEqual({ average: null, sampleSize: 0 });
    // Guard against a silent NaN leaking into the JSON response instead of
    // an explicit null — JSON.stringify(NaN) is "null" too, so this checks
    // the raw body text carries no stray "NaN" token anywhere.
    expect(res.text).not.toContain("NaN");
  });

  it("returns 500 when the database fails", async () => {
    const pool = {
      query: async () => {
        throw new Error("connection lost");
      },
    } as unknown as Pool;
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/analytics").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(500);
  });
});
