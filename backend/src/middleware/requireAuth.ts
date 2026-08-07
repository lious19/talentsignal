import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/jwt";

/**
 * Verifies a bearer token and attaches { id, role } to req.user. Wired into
 * every route except health and auth's own register/login (by design). This
 * only answers "is there a valid token," never "is this role allowed here" —
 * that's requireRole (06_decisions/022), which must run after this.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, role: claims.role };
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}
