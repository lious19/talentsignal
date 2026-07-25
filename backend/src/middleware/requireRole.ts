import type { NextFunction, Request, Response } from "express";

/**
 * Must run after requireAuth — reads req.user, which only requireAuth sets.
 * Deliberately narrow: this answers "is this role on the allow-list for this
 * route," not S-14's resource-ownership question ("does this user own this
 * specific record"). See S-05's scope note on the difference.
 */
export function requireRole(roles: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "insufficient role" });
      return;
    }
    next();
  };
}
