import { SEGMENTATION_CONFIG } from "./segmentationConfig";

export type SegmentLabel = "low" | "medium" | "high";

export interface SegmentedClient {
  id: string;
  name: string;
  openRoles: number;
}

export interface SegmentGroup {
  segment: SegmentLabel;
  clients: SegmentedClient[];
}

function segmentFor(openRoles: number): SegmentLabel {
  if (openRoles >= SEGMENTATION_CONFIG.thresholds.high) return "high";
  if (openRoles >= SEGMENTATION_CONFIG.thresholds.medium) return "medium";
  return "low";
}

// Most-open-roles-first within a group, name as the tiebreak — same
// byXThenId determinism convention as opportunityRelationships.ts's
// byConfidenceThenKey.
function byOpenRolesThenName(a: SegmentedClient, b: SegmentedClient): number {
  if (b.openRoles !== a.openRoles) return b.openRoles - a.openRoles;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Pure, no I/O — the ScoringAgent boundary for segmentation, same shape as
 * classifyAnomalies/computeForecast/scoreCandidate. Advisory only by
 * construction, not just by policy: this never writes anywhere, and its
 * output is read by exactly one route (GET /api/analytics/anomalies) — no
 * automated-targeting code path (recommendationEngine.ts, etc.) ever reads
 * a client's segment.
 *
 * Empty groups are omitted from the result — nothing downstream needs to
 * render "0 clients in this bucket."
 */
export function segmentClients(
  clients: { id: string; name: string }[],
  openRoleCounts: Map<string, number>,
): SegmentGroup[] {
  const groups: Record<SegmentLabel, SegmentedClient[]> = { low: [], medium: [], high: [] };

  for (const client of clients) {
    const openRoles = openRoleCounts.get(client.id) ?? 0;
    groups[segmentFor(openRoles)].push({ id: client.id, name: client.name, openRoles });
  }

  return (["high", "medium", "low"] as SegmentLabel[])
    .map((segment) => ({ segment, clients: groups[segment].sort(byOpenRolesThenName) }))
    .filter((group) => group.clients.length > 0);
}
