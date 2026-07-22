import { Router } from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import type { Pool } from "pg";
import { logger } from "../logger";
import { signAccessToken } from "../auth/jwt";
import { BCRYPT_COST, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "../auth/passwordHashing";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Burned once at cost 12 so it has the same shape (and cost) as a real
// stored hash. Used only to keep the login timing path constant — see the
// comment on DUMMY_HASH's usage in the login handler below.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-parity", BCRYPT_COST);

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

export function authRouter(pool: Pool): Router {
  const router = Router();

  // Created per authRouter() call (i.e. per createApp() call, once per
  // process in production) rather than at module scope, so its counter
  // store isn't accidentally shared across unrelated tests that each build
  // their own app via createApp(fakePool()).
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many attempts, try again later" },
  });
  router.use(authRateLimit);

  router.post("/auth/register", async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

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

    // Privilege-escalation guard: role is never read from req.body. Every
    // self-registration is 'sales'; only bootstrapAdmin (env-driven, at
    // boot) can create an admin. See 06_decisions/003.
    const role = "sales";

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id, email, role`,
        [email, passwordHash, role],
      );
      const user = rows[0];
      logger.info({ correlationId: req.correlationId, userId: user.id }, "user registered");
      res.status(201).json({ id: user.id, email: user.email, role: user.role });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "an account with this email already exists" });
        return;
      }
      logger.error({ correlationId: req.correlationId, err }, "registration failed");
      res.status(500).json({ error: "registration failed" });
    }
  });

  router.post("/auth/login", async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    try {
      const { rows } = await pool.query(
        "SELECT id, email, password_hash, role FROM users WHERE lower(email) = $1",
        [email],
      );
      const user = rows[0] as
        | { id: string; email: string; password_hash: string; role: string }
        | undefined;

      // Always compare against a real bcrypt hash, even when no user was
      // found, so an unknown email costs the same as a wrong password —
      // otherwise the response time itself would leak which emails exist.
      const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

      if (!user || !passwordMatches) {
        res.status(401).json({ error: "invalid email or password" });
        return;
      }

      const token = signAccessToken({ sub: user.id, role: user.role });
      res.status(200).json({
        token,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "login failed");
      res.status(500).json({ error: "login failed" });
    }
  });

  return router;
}
