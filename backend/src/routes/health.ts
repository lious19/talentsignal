import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";

export function healthRouter(pool: Pool): Router {
  const router = Router();

  router.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ status: "ok", db: "ok" });
    } catch (err) {
      logger.error(
        { correlationId: req.correlationId, err },
        "health check: database unreachable",
      );
      res.status(503).json({ status: "error", db: "unreachable" });
    }
  });

  return router;
}
