import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { CapacitySignalProvider } from "../adapters/capacitySignalProvider";
import { logger } from "../logger";

export interface CapacityProviderRunResult {
  ok: boolean;
  signalCount: number;
  error?: string;
}

export interface IngestCapacitySignalsResult {
  correlationId: string;
  h1bLca: CapacityProviderRunResult;
  federalAward: CapacityProviderRunResult;
  formD: CapacityProviderRunResult;
  targetCompanyNames: string[];
}

// The only real companies worth checking capacity sources against -- pulled
// from the live opportunities table (never hardcoded, never including
// seed-job-board's fictional names, which can never match real government
// data). Exported: the CALLER must resolve this BEFORE constructing the
// three providers (each provider needs the list at construction time, same
// as GreenhouseProvider/LeverProvider take boardTokens/companyHandles at
// construction) -- mirrors ingest-once.ts's own shape, where the script
// resolves the target list (there, from env) before building providers,
// not ingestRequisitions() itself.
export async function getTargetCompanyNames(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ company: string }>(
    "SELECT DISTINCT company FROM opportunities WHERE source != 'seed-job-board'",
  );
  return rows.map((row) => row.company);
}

/**
 * S-24: the batch runner for capacity-signal ingestion -- mirrors
 * ingestRequisitions.ts's shape exactly (per-source isolation, one
 * correlation id threading every log line, CLAUDE.md rule 8), but is NOT
 * wired into the live /hidden-demand/analyze route. Capacity ingestion
 * (especially LCA's 73MB file) is a separate, occasional batch job, run via
 * `npm run ingest:capacity-once`, same "no live external call inside the hot
 * scoring path" discipline decision 046 already established. Scoring later
 * just reads whatever's already in raw_capacity_signals.
 */
export async function ingestCapacitySignals(
  providers: { h1bLca: CapacitySignalProvider; federalAward: CapacitySignalProvider; formD: CapacitySignalProvider },
  options: { timeoutMs: number; correlationId?: string; targetCompanyNames: string[] },
): Promise<IngestCapacitySignalsResult> {
  const correlationId = options.correlationId ?? randomUUID();
  const { targetCompanyNames } = options;

  async function runProvider(
    name: "h1bLca" | "federalAward" | "formD",
    provider: CapacitySignalProvider,
  ): Promise<CapacityProviderRunResult> {
    try {
      const signals = await provider.fetchSignals({ timeoutMs: options.timeoutMs, runId: correlationId });
      logger.info({ correlationId, provider: name, count: signals.length }, "capacity signal ingestion provider succeeded");
      return { ok: true, signalCount: signals.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ correlationId, provider: name, err }, "capacity signal ingestion provider failed");
      return { ok: false, signalCount: 0, error: message };
    }
  }

  const [h1bLca, federalAward, formD] = await Promise.all([
    runProvider("h1bLca", providers.h1bLca),
    runProvider("federalAward", providers.federalAward),
    runProvider("formD", providers.formD),
  ]);

  logger.info({ correlationId, targetCompanyNames }, "capacity signal ingestion run completed");

  return { correlationId, h1bLca, federalAward, formD, targetCompanyNames };
}
