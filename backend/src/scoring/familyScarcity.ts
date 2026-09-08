import type { Pool } from "pg";

export interface FamilyScarcityLookup {
  // Greenhouse-only median daysOpen across every classified row, used as the
  // "2x this = scarce" reference point.
  globalMedianDaysOpen: number;
  byFamily: Record<string, { count: number; medianDaysOpen: number }>;
}

/**
 * S-23: median daysOpen per role family, computed from Greenhouse rows only
 * (06_decisions/046). Lever is excluded entirely, from both the per-family
 * and the global median -- its real median daysOpen runs roughly 35x
 * Greenhouse's, almost certainly because Lever's raw `createdAt` field
 * doesn't mean "posting opened" the way this scorer assumes, not because
 * gopuff roles are genuinely that much harder to fill. Publishing a
 * "measured" claim built on that number would itself be the invented metric
 * this story exists to replace. Revisit once Lever's field semantics are
 * confirmed with a real client integration.
 *
 * Called once per scoring run (not per signal) -- the result is a lookup
 * table passed into hardToFillScore() for every signal in that run, keeping
 * hardToFillScore() itself synchronous and DB-free, same as every other
 * factor it computes.
 */
export async function computeFamilyScarcity(pool: Pool): Promise<FamilyScarcityLookup> {
  const globalResult = await pool.query<{ median: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days_open) AS median
     FROM opportunities WHERE source = 'greenhouse'`,
  );
  const globalMedianDaysOpen = Math.round(Number(globalResult.rows[0]?.median ?? 0));

  // "general-other" is deliberately excluded here, not just left to clear the
  // threshold naturally -- it is classifyFamily()'s catch-all for titles that
  // matched no real family (heavily leadership/management titles, see
  // 06_decisions/046's known-limits section), not a coherent role family. A
  // median computed across that bucket would blend a Director role with
  // whatever else landed there, which is worse than not measuring it at all
  // -- exactly the reasoning that decision already rejected for a dedicated
  // "leadership" family, so it can't be allowed to sneak in here just
  // because "general-other" happens to clear the observation count.
  const byFamilyResult = await pool.query<{ family_key: string; count: string; median: string }>(
    `SELECT family_key, count(*) AS count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY days_open) AS median
     FROM opportunities
     WHERE source = 'greenhouse' AND family_key IS NOT NULL AND family_key != 'general-other'
     GROUP BY family_key`,
  );

  const byFamily: FamilyScarcityLookup["byFamily"] = {};
  for (const row of byFamilyResult.rows) {
    byFamily[row.family_key] = { count: Number(row.count), medianDaysOpen: Math.round(Number(row.median)) };
  }

  return { globalMedianDaysOpen, byFamily };
}
