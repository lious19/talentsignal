import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { toOpportunityResponse, type OpportunityRow } from "./hiddenDemand";

function isValidIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && id.trim().length > 0)
  );
}

/**
 * S-07 (REQ-003): the read-through audit endpoint the story's slice names.
 * Deliberately does ZERO scoring — scoreSignal() is never called here, and
 * nothing is written. It only looks up rows that S-04's analyze pipeline
 * already scored and persisted, and shapes them through the exact same
 * toOpportunityResponse() that route uses, so there is still exactly one
 * place in the codebase that ever computes a confidence score, and this
 * route can never drift from it.
 *
 * Because it's a plain read with no write in between, calling it twice with
 * the same ids is trivially idempotent — even updated_at, which legitimately
 * changes across two /hidden-demand/analyze calls, cannot change here.
 *
 * Any requested id that doesn't exist is simply omitted from the response,
 * matching GET /hidden-demand/opportunities's existing "return what exists"
 * style rather than adding per-id 404 bookkeeping.
 */
export function opportunitiesRouter(pool: Pool): Router {
  const router = Router();

  router.post("/opportunities/score", requireAuth, async (req, res) => {
    const opportunityIds = req.body?.opportunityIds;
    if (!isValidIdList(opportunityIds)) {
      res.status(400).json({ error: "opportunityIds must be a non-empty array of strings" });
      return;
    }

    try {
      const { rows } = await pool.query("SELECT * FROM opportunities WHERE id = ANY($1)", [
        opportunityIds,
      ]);
      const opportunities = (rows as OpportunityRow[]).map(toOpportunityResponse);

      logger.info(
        { correlationId: req.correlationId, requested: opportunityIds.length, found: opportunities.length },
        "opportunities score lookup completed",
      );
      res.status(200).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunities score lookup failed");
      res.status(500).json({ error: "score lookup failed" });
    }
  });

  return router;
}
