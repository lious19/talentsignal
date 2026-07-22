export interface MarketSignal {
  source: string;
  externalId: string;
  company: string;
  title: string;
  daysOpen: number;
  isRepost: boolean;
  hasSalaryRange: boolean;
}

export interface FetchSignalsOptions {
  timeoutMs: number;
}

/**
 * Implemented by every market-signal source, mocked or real. Callers (the
 * hidden-demand route) depend only on this interface — server.ts is the one
 * place that decides which concrete provider gets constructed, so swapping
 * the mock for a real job-board API later means changing one wiring line,
 * not the route, the scoring function, or any test that uses a fake provider.
 */
export interface MarketSignalProvider {
  fetchSignals(options: FetchSignalsOptions): Promise<MarketSignal[]>;
}
