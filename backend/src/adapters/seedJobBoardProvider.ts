import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";

/**
 * Deterministically generates a batch of synthetic signals — for demoing
 * ranking (S-04) and for measuring the AC-4-2 latency target against a
 * realistic row count. Index-derived, not random, so the same count always
 * produces the same batch: demos and tests are reproducible.
 *
 * source is "seed-job-board", deliberately distinct from MockJobBoardProvider's
 * "mock-job-board", so seed rows are always identifiable and excludable from
 * the demand board (see the includeSeedData filter in hiddenDemand.ts). Never
 * constructed by default in server.ts — opt-in only, via
 * MARKET_SIGNAL_PROVIDER=seed. A fuller seed/reset story belongs to S-19;
 * this is scoped to what S-04 needs.
 */
export class SeedJobBoardProvider implements MarketSignalProvider {
  constructor(private readonly count: number) {}

  async fetchSignals(_options: FetchSignalsOptions): Promise<MarketSignal[]> {
    const signals: MarketSignal[] = [];
    for (let i = 0; i < this.count; i++) {
      signals.push({
        source: "seed-job-board",
        externalId: `seed-${i}`,
        company: `Seed Co ${String(i).padStart(5, "0")}`,
        title: "Seeded Role",
        daysOpen: i % 45,
        isRepost: i % 3 === 0,
        hasSalaryRange: i % 2 === 0,
      });
    }
    return signals;
  }
}
