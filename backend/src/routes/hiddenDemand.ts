import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import type { MarketSignalProvider } from "../adapters/marketSignalProvider";
import { scoreSignal } from "../scoring/confidenceScore";

// The mock does no real I/O, but the timeout is real regardless: it bounds
// how long a hung or slow provider (mock or, later, a real HTTP call) can
// block this request, per CLAUDE.md rule 8.
const PROVIDER_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`provider timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

interface OpportunityRow {
  id: string;
  source: string;
  external_signal_id: string;
  company: string;
  confidence_score: string;
  reasons: string[];
  created_at: string;
  updated_at: string;
}

// pg returns NUMERIC columns as strings (to avoid silent precision loss), so
// confidence_score needs an explicit conversion back to a number here.
function toOpportunityResponse(row: OpportunityRow) {
  return {
    id: row.id,
    company: row.company,
    confidenceScore: Number(row.confidence_score),
    reasons: row.reasons,
    source: row.source,
    externalSignalId: row.external_signal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function hiddenDemandRouter(
  pool: Pool,
  provider: MarketSignalProvider,
  options?: { providerTimeoutMs?: number },
): Router {
  const providerTimeoutMs = options?.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
  const router = Router();

  router.post("/hidden-demand/analyze", requireAuth, async (req, res) => {
    let signals;
    try {
      signals = await withTimeout(
        provider.fetchSignals({ timeoutMs: providerTimeoutMs }),
        providerTimeoutMs,
      );
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "hidden-demand provider call failed");
      const isTimeout = err instanceof Error && err.message.includes("timed out");
      res
        .status(isTimeout ? 504 : 502)
        .json({ error: isTimeout ? "provider timed out" : "provider unavailable" });
      return;
    }

    try {
      const opportunities = [];
      for (const signal of signals) {
        const { score, reasons } = scoreSignal(signal);
        const { rows } = await pool.query(
          `INSERT INTO opportunities (source, external_signal_id, company, confidence_score, reasons)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source, external_signal_id)
           DO UPDATE SET confidence_score = EXCLUDED.confidence_score,
                         reasons = EXCLUDED.reasons,
                         updated_at = now()
           RETURNING *`,
          [signal.source, signal.externalId, signal.company, score, reasons],
        );
        opportunities.push(toOpportunityResponse(rows[0] as OpportunityRow));
      }

      logger.info(
        { correlationId: req.correlationId, count: opportunities.length },
        "hidden-demand analyze completed",
      );
      res.status(201).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "hidden-demand analyze failed");
      res.status(500).json({ error: "analyze failed" });
    }
  });

  router.get("/hidden-demand/opportunities", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM opportunities ORDER BY created_at DESC");
      res.status(200).json({ opportunities: rows.map((row) => toOpportunityResponse(row as OpportunityRow)) });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list opportunities failed");
      res.status(500).json({ error: "failed to list opportunities" });
    }
  });

  return router;
}
