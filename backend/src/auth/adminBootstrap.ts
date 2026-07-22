import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { logger } from "../logger";
import { BCRYPT_COST } from "./passwordHashing";

/**
 * The only way an admin account is ever created. Public self-registration
 * (routes/auth.ts) always assigns 'sales' and never reads a role from the
 * request body, so without this, there would be no way into the system as
 * admin at all. Runs on every boot; safe to leave wired permanently — once
 * any admin exists, or the env vars aren't set, it's a no-op.
 */
export async function bootstrapAdmin(pool: Pool): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) return;

  const { rows } = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length > 0) return;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // ON CONFLICT DO NOTHING is the same TOCTOU defense as registration's
  // unique-violation catch: the SELECT above is an optimization to skip
  // hashing on every boot once an admin exists, not the actual guarantee.
  await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES (lower($1), $2, 'admin')
     ON CONFLICT (lower(email)) DO NOTHING`,
    [email, passwordHash],
  );

  logger.info({ email: email.toLowerCase() }, "bootstrap admin ensured");
}
