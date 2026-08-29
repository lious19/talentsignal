import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { MarketSignal, MarketSignalProvider } from "../adapters/marketSignalProvider";
import { upsertBatch } from "../routes/hiddenDemand";
import { logger } from "../logger";

// `ok` means "this provider's fetchSignals() call resolved without
// throwing" -- NOT "every board/handle inside it succeeded." Each provider
// (GreenhouseProvider/LeverProvider) isolates and logs its own per-board
// failures internally (06_decisions/040) and returns whatever signals it
// did get, so a fully-down provider still shows ok: true, signalCount: 0
// here. `ok: false` only fires for a failure outside that per-board
// isolation (a bug, or a rejection before any board-level try/catch runs).
export interface ProviderRunResult {
  ok: boolean;
  signalCount: number;
  error?: string;
}

export interface IngestRequisitionsResult {
  correlationId: string;
  greenhouse: ProviderRunResult;
  lever: ProviderRunResult;
  opportunitiesUpserted: number;
}

/**
 * The batch runner every real ingestion (the demo trigger today, a cron
 * wrapper later) goes through -- constructs nothing itself, just
 * orchestrates providers it's handed and the existing upsertBatch() path.
 *
 * Provider-level isolation (acceptance criterion 4, belt-and-suspenders on
 * top of each provider's own per-board isolation): if GreenhouseProvider
 * throws for a reason outside its own per-board try/catch (a bug, a DNS
 * failure before any board-level request starts), Lever's signals still
 * reach upsertBatch(). One correlation id threads every log line for the
 * whole run (CLAUDE.md rule 8).
 */
export async function ingestRequisitions(
  pool: Pool,
  providers: { greenhouse: MarketSignalProvider; lever: MarketSignalProvider },
  options: { timeoutMs: number; correlationId?: string },
): Promise<IngestRequisitionsResult> {
  const correlationId = options.correlationId ?? randomUUID();
  const allSignals: MarketSignal[] = [];

  async function runProvider(name: "greenhouse" | "lever", provider: MarketSignalProvider): Promise<ProviderRunResult> {
    try {
      const signals = await provider.fetchSignals({ timeoutMs: options.timeoutMs });
      allSignals.push(...signals);
      logger.info({ correlationId, provider: name, count: signals.length }, "ingestion provider succeeded");
      return { ok: true, signalCount: signals.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ correlationId, provider: name, err }, "ingestion provider failed");
      return { ok: false, signalCount: 0, error: message };
    }
  }

  const [greenhouse, lever] = await Promise.all([
    runProvider("greenhouse", providers.greenhouse),
    runProvider("lever", providers.lever),
  ]);

  const opportunities = await upsertBatch(pool, allSignals);

  logger.info(
    { correlationId, opportunitiesUpserted: opportunities.length },
    "ingestion run completed",
  );

  return {
    correlationId,
    greenhouse,
    lever,
    opportunitiesUpserted: opportunities.length,
  };
}
