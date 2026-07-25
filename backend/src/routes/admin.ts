import { Router } from "express";
import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { BCRYPT_COST, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "../auth/passwordHashing";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CREATABLE_ROLES = ["admin", "sales", "recruiter"];

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

// The only path (besides env-driven bootstrapAdmin at boot) that can create
// an account with a chosen role — gated to 'admin' the same way
// bootstrapAdmin is the only path to the very first admin. This is what
// closes the gap decision 003 flagged in advance: there was previously no
// way for a recruiter account to come into existence at all. See
// 06_decisions/010.
export function adminRouter(pool: Pool): Router {
  const router = Router();

  router.post("/admin/users", requireAuth, requireRole(["admin"]), async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const role = req.body?.role;

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "a valid email is required" });
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      res.status(400).json({
        error: `password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
      });
      return;
    }
    if (typeof role !== "string" || !CREATABLE_ROLES.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${CREATABLE_ROLES.join(", ")}` });
      return;
    }

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3) RETURNING id, email, role`,
        [email, passwordHash, role],
      );
      const user = rows[0];
      logger.info(
        { correlationId: req.correlationId, userId: user.id, role: user.role },
        "user created by admin",
      );
      res.status(201).json({ id: user.id, email: user.email, role: user.role });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "an account with this email already exists" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "admin user creation failed");
      res.status(500).json({ error: "user creation failed" });
    }
  });

  return router;
}
