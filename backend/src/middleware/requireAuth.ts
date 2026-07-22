import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/jwt";

/**
 * Verifies a bearer token and attaches { id, role } to req.user. Not wired
 * into any route yet — S-14 builds RBAC on top of this, deciding which
 * routes require it and what each role may do. This only answers "is there a
 * valid token," never "is this role allowed here."
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
