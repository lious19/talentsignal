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
    // Two fixed signals so the demo shows the contrast HF-2 exists to surface:
    // one generic role that is NOT flagged hard-to-fill, and one scarce role
    // (a "data analyst", exactly Ali's Aug 17 example) that IS. Deterministic,
    // no randomness — the demo and any manual check always see the same board.
    const genericRole: MarketSignal = {
      source: "mock-job-board",
      externalId: "jb-1001",
      company: "Acme Corp",
      title: "Senior Recruiter",
      daysOpen: 24,
      isRepost: true,
      hasSalaryRange: false,
    };
    const hardToFillRole: MarketSignal = {
      source: "mock-job-board",
      externalId: "jb-1002",
      company: "Insight Analytics",
      title: "Senior Data Analyst",
      daysOpen: 30,
      isRepost: true,
      hasSalaryRange: false,
    };
    return [genericRole, hardToFillRole];
  }
}
