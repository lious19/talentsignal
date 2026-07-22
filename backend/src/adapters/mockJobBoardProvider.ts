import type { FetchSignalsOptions, MarketSignal, MarketSignalProvider } from "./marketSignalProvider";

/**
 * Fixed, deterministic mocked job-board signal — no randomness, so the demo
 * and the tests always see the same result. A real provider (e.g. an
 * IndeedProvider) would call an actual API here instead, respecting the same
 * timeoutMs contract, and would be swapped in at server.ts with no changes
 * to anything that consumes MarketSignalProvider.
 */
export class MockJobBoardProvider implements MarketSignalProvider {
  async fetchSignals(_options: FetchSignalsOptions): Promise<MarketSignal[]> {
    const signal: MarketSignal = {
      source: "mock-job-board",
      externalId: "jb-1001",
      company: "Acme Corp",
      title: "Senior Recruiter",
      daysOpen: 24,
      isRepost: true,
      hasSalaryRange: false,
    };
    return [signal];
  }
}
