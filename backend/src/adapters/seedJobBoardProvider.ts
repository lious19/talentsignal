import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";
import { HARD_TO_FILL_CONFIG } from "../scoring/hardToFillConfig";

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
 *
 * S-18 addition: every 3rd row's title cycles through
 * HARD_TO_FILL_CONFIG.roleKeywords (the same list hardToFillScore.ts matches
 * against) instead of the constant "Seeded Role". Without this, roleScarcity
 * — 0.6 of the 1.0 hard-to-fill weight — can never fire for a seeded row, and
 * daysOpen+repostedRole alone cap at 0.4, below the 0.5 hardToFillThreshold
 * by construction. That made every seeded opportunity mathematically
 * incapable of reaching hard-to-fill status, which in turn meant
 * /hard-to-fill/targeting had zero targets to rank regardless of its source
 * filter. See 06_decisions/028. The remaining 2 of every 3 rows keep the
 * generic title so daysOpen/repostedRole still get exercised on their own,
 * same as before this change. Confirmed safe against
 * hiddenDemand.latency.integration.test.ts, which asserts only on
 * durationMs, never on title content.
 */
export class SeedJobBoardProvider implements MarketSignalProvider {
  constructor(private readonly count: number) {}

  async fetchSignals(_options: FetchSignalsOptions): Promise<MarketSignal[]> {
    const { roleKeywords } = HARD_TO_FILL_CONFIG;
    const signals: MarketSignal[] = [];
    for (let i = 0; i < this.count; i++) {
      const title =
        i % 3 === 0
          ? roleKeywords[Math.floor(i / 3) % roleKeywords.length]
          : "Seeded Role";
      signals.push({
        source: "seed-job-board",
        externalId: `seed-${i}`,
        company: `Seed Co ${String(i).padStart(5, "0")}`,
        title,
        daysOpen: i % 45,
        isRepost: i % 3 === 0,
        hasSalaryRange: i % 2 === 0,
      });
    }
    return signals;
  }
}
