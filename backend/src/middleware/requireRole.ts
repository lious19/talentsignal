import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger";

/**
 * Must run after requireAuth — reads req.user, which only requireAuth sets.
 * Deliberately narrow: this answers "is this role on the allow-list for this
 * route," not S-14's resource-ownership question ("does this user own this
 * specific record") — see requireOwnership.ts for that. Every denial is
 * logged (06_decisions/022's acceptance scenario: "the Express guard returns
 * 403 and the attempt is logged"), reusing the same structured logger and
 * correlation id every other route already logs through.
 */
export function requireRole(roles: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user || !roles.includes(req.user.role)) {
      logger.warn(
        {
          correlationId: req.correlationId,
          userId: req.user?.id,
          role: req.user?.role,
          route: req.path,
          method: req.method,
        },
        "access denied — role",
      );
      res.status(403).json({ error: "insufficient role" });
      return;
    }
    next();
  };
}
