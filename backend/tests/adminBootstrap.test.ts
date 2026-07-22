import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { bootstrapAdmin } from "../src/auth/adminBootstrap";

function fakeAdminPool(existingAdmin: boolean) {
  const inserted: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT 1 FROM users WHERE role = 'admin'")) {
      return { rows: existingAdmin ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("INSERT INTO users")) {
      inserted.push(params);
      return { rows: [] };
    }
    throw new Error(`fakeAdminPool: unexpected query — ${sql}`);
  });
  return { pool: { query } as unknown as Pool, query, inserted };
}

describe("bootstrapAdmin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing if ADMIN_EMAIL/ADMIN_BOOTSTRAP_PASSWORD aren't set", async () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    vi.stubEnv("ADMIN_BOOTSTRAP_PASSWORD", "");
    const { pool, query } = fakeAdminPool(false);

    await bootstrapAdmin(pool);

    expect(query).not.toHaveBeenCalled();
  });

  it("creates exactly one admin, with a bcrypt hash, when none exists yet", async () => {
    vi.stubEnv("ADMIN_EMAIL", "Admin@Example.com");
    vi.stubEnv("ADMIN_BOOTSTRAP_PASSWORD", "a-strong-bootstrap-password");
    const { pool, inserted } = fakeAdminPool(false);

    await bootstrapAdmin(pool);

    expect(inserted).toHaveLength(1);
    const [email, passwordHash] = inserted[0] as [string, string];
    expect(email).toBe("Admin@Example.com");
    expect(passwordHash).not.toBe("a-strong-bootstrap-password");
    await expect(
      bcrypt.compare("a-strong-bootstrap-password", passwordHash),
    ).resolves.toBe(true);
  });

  it("is a no-op once an admin already exists", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("ADMIN_BOOTSTRAP_PASSWORD", "a-strong-bootstrap-password");
    const { pool, inserted } = fakeAdminPool(true);

    await bootstrapAdmin(pool);

    expect(inserted).toHaveLength(0);
  });
});
