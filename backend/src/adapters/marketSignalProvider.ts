export interface MarketSignal {
  source: string;
  externalId: string;
  company: string;
  title: string;
  daysOpen: number;
  isRepost: boolean;
  hasSalaryRange: boolean;
  // S-22: cumulative counts computeDiffs.ts derives from raw_requisitions
  // history (06_decisions/043 repost, 044 churn) -- carried on MarketSignal
  // so they reach upsertBatch's persistence layer without scoreSignal()/
  // hardToFillScore() changing at all. isRepost above is just
  // `repostCount > 0`; the scorers still read isRepost/daysOpen exactly as
  // before, now with real inputs instead of seeded ones. Optional so every
  // existing MarketSignal literal (mocks, seeds, tests) keeps compiling
  // unchanged -- undefined is treated as 0 at the one place these are
  // persisted (hiddenDemand.ts's upsertChunk).
  repostCount?: number;
  descriptionChurn?: number;
}

export interface FetchSignalsOptions {
  timeoutMs: number;
  // S-22: identifies which ingestRequisitions() call this fetch belongs to,
  // so the differ can tell "this source was polled and this item wasn't in
  // it" apart from "this source was never polled again" (06_decisions/043).
  // Optional so every existing caller/test keeps compiling; a provider that
  // doesn't receive one generates its own, so it still works called alone.
  runId?: string;
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
