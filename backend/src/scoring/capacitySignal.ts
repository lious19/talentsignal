import type { Pool } from "pg";
import { matchCompany } from "../matching/companyMatch";
import { CAPACITY_SIGNAL_CONFIG } from "./hardToFillConfig";

export interface CapacitySignalRow {
  source: string;
  employerNameRaw: string;
  eventDate: string | null;
}

export interface CapacitySignalLookup {
  rows: CapacitySignalRow[];
}

// S-24: mirrors familyScarcity.ts's shape -- one query per scoring run, not
// per signal, reused across every signal that run scores. Reads whatever's
// already in raw_capacity_signals; ingestion (LcaProvider/
// FederalAwardsProvider/FormDProvider, via `npm run ingest:capacity-once`)
// is a separate, occasional batch job, not run here.
// node-postgres parses a DATE column into a native JS Date, regardless of
// how the query's TS generic types it -- a real bug this exact line caused
// until a real end-to-end run (Step 5b) surfaced it: interpolating a Date
// object into a template string calls its default .toString()
// ("Mon Sep 26 2016 00:00:00 GMT-0500 (Central Daylight Time)"), not a
// clean ISO date, in every capacity rationale sentence. Every unit test
// used a string literal in a fake pool, so this was invisible until a real
// pg row went through it. Normalized explicitly here, once, so nothing
// downstream (recency math, rationale strings) has to guard against it.
function toIsoDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export async function computeCapacitySignalLookup(pool: Pool): Promise<CapacitySignalLookup> {
  const { rows } = await pool.query<{ source: string; employer_name_raw: string; event_date: unknown }>(
    "SELECT source, employer_name_raw, event_date FROM raw_capacity_signals",
  );
  return {
    rows: rows.map((row) => ({
      source: row.source,
      employerNameRaw: row.employer_name_raw,
      eventDate: toIsoDateString(row.event_date),
    })),
  };
}

export type CapacitySignalBasis = "measured" | "curated" | "none";

export interface ResolvedCapacitySignal {
  value: number;
  basis: CapacitySignalBasis;
  capacitySource?: string;
  matchedEmployerName?: string;
  eventDate?: string | null;
  recencyExcluded?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  "h1b-lca": "H-1B LCA",
  "federal-award": "federal award",
  "form-d": "Form D",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function monthsSince(eventDateIso: string, now: Date): number {
  const eventDate = new Date(eventDateIso);
  return (now.getFullYear() - eventDate.getFullYear()) * 12 + (now.getMonth() - eventDate.getMonth());
}

/**
 * S-24 Decision C: contribution = weight * matchConfidence * sourceStrength
 * * recencyGate (exact formula, no extra multipliers). Picks the
 * best-scoring raw_capacity_signals row for this opportunity's company
 * across all three sources -- "best" by matchConfidence, so a
 * high-confidence match from a weaker source can still beat a low-
 * confidence match from a stronger one when that's genuinely the better
 * evidence.
 *
 * A real match whose event is outside the recency window still reports its
 * real basis/matchedEmployerName/eventDate (recencyExcluded: true) --
 * zeroed contribution, but never silently indistinguishable from "no match
 * ever existed" (06_decisions/047's "no hidden inputs" standard).
 *
 * A match below dropBelowThreshold is treated identically to "no match" --
 * basis "none", no matched-name/source exposed -- per Decision B (criterion
 * 3: never shown as if it were real evidence).
 */
export function resolveCapacitySignal(
  companyName: string,
  lookup: CapacitySignalLookup | undefined,
  now: Date = new Date(),
): ResolvedCapacitySignal {
  if (!lookup || lookup.rows.length === 0) {
    return { value: 0, basis: "none" };
  }

  let best: { row: CapacitySignalRow; score: number } | undefined;
  for (const row of lookup.rows) {
    const match = matchCompany(companyName, row.employerNameRaw);
    if (!best || match.score > best.score) {
      best = { row, score: match.score };
    }
  }

  if (!best || best.score < CAPACITY_SIGNAL_CONFIG.dropBelowThreshold) {
    return { value: 0, basis: "none" };
  }

  const basis: CapacitySignalBasis = best.score >= CAPACITY_SIGNAL_CONFIG.highConfidenceThreshold ? "measured" : "curated";
  const sourceStrength = CAPACITY_SIGNAL_CONFIG.sourceStrength[best.row.source] ?? 0;
  const eventDate = best.row.eventDate;
  // No event date at all -- can't verify recency, so the honest default is
  // "not within window" (recencyGate 0), never a silent assumption that an
  // undated signal is current.
  const withinWindow = eventDate !== null && monthsSince(eventDate, now) <= CAPACITY_SIGNAL_CONFIG.recencyMonths;
  const recencyGate = withinWindow ? 1 : 0;

  return {
    value: best.score * sourceStrength * recencyGate,
    basis,
    capacitySource: best.row.source,
    matchedEmployerName: best.row.employerNameRaw,
    eventDate,
    recencyExcluded: !withinWindow,
  };
}
