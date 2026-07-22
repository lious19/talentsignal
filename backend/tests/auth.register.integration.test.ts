import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";

// The fake pool in the other register tests simulates a unique-violation;
// this proves the real guarantee — that Postgres itself, not application
// code, is what stops a genuine concurrent duplicate registration. Skipped
// unless a real database is available (docker-compose, CI), same pattern as
// migrate.test.ts.
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("POST /auth/register (integration, requires DATABASE_URL)", () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a genuinely concurrent duplicate registration: exactly one wins", async () => {
    const app = createApp(pool, noopProvider);
    // Unique per test run so this never collides with a previous run's data
    // and needs no cleanup.
    const email = `concurrent-${randomUUID()}@example.com`;
    const body = { email, password: "correct-horse-battery" };

    // Fired together, not sequentially, to actually exercise the race rather
    // than just two calls that happen to run one after the other.
    const [first, second] = await Promise.all([
      request(app).post("/api/auth/register").send(body),
      request(app).post("/api/auth/register").send(body),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { rows } = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [
      email,
    ]);
    expect(rows).toHaveLength(1);
  });
});
