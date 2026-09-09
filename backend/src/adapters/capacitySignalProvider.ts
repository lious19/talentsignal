// S-24: a NEW sibling interface, not an extension of MarketSignalProvider.
// MarketSignalProvider's shape (company/title/daysOpen/isRepost/hasSalaryRange)
// is job-posting-specific -- none of H-1B LCA, federal contract awards, or SEC
// Form D produce job postings. Mirrors decision 040's own precedent: that
// decision explicitly rejected overloading one interface to do two jobs
// (MockJobBoardProvider/SeedJobBoardProvider would have grown a meaningless
// stub method) -- the same reasoning applies here in the other direction: a
// capacity filing forced into MarketSignal's shape would need fake title/
// daysOpen/isRepost/hasSalaryRange values, which is worse than a second,
// honestly-shaped interface.
export interface CapacitySignal {
  source: "h1b-lca" | "federal-award" | "form-d";
  // Exactly as filed with the source agency -- never normalized here. Company
  // matching (backend/src/matching/companyMatch.ts) is a separate, pure step
  // applied at scoring time, so the raw evidence this adapter persists is
  // never altered by a matching decision.
  employerNameRaw: string;
  // ISO date (YYYY-MM-DD). LCA: DECISION_DATE. Federal award: the real
  // period-of-performance start date, fetched via the per-award detail
  // endpoint (06_decisions/047 -- the search endpoint's own field is null).
  // Form D: SALE_DATE (real field name; not "dateOfFirstSale"). Null when the
  // source genuinely has no date for this row (e.g. Form D's YETTOOCCUR case).
  eventDate: string | null;
  // LCA only -- the only one of the three sources with any occupation data.
  roleTitle?: string;
  socCode?: string;
}

export interface FetchCapacitySignalsOptions {
  timeoutMs: number;
  runId?: string;
}

export interface CapacitySignalProvider {
  fetchSignals(options: FetchCapacitySignalsOptions): Promise<CapacitySignal[]>;
}
