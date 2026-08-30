import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { GreenhouseProvider } from "../src/adapters/greenhouseProvider";

/**
 * The one real-network test S-21's plan calls for: hits the actual live
 * Greenhouse public board API for a single stable board, not a fixture.
 * Guarded by an env var CI never sets, same self-skip precedent as
 * *.latency.integration.test.ts (06_decisions/028) -- so this suite never
 * makes CI's green/red depend on an external company's uptime or on
 * network access being available in the CI runner at all.
 *
 * Run manually with: RUN_LIVE_INGESTION_TESTS=1 npx vitest run
 * tests/greenhouseProvider.liveNetwork.integration.test.ts
 */
const describeIfLive = process.env.RUN_LIVE_INGESTION_TESTS === "1" ? describe : describe.skip;

describeIfLive("GreenhouseProvider live network (integration, requires network + RUN_LIVE_INGESTION_TESTS=1)", () => {
  it(
    "fetches a real board and returns at least one parsed signal",
    async () => {
      const calls: unknown[][] = [];
      // S-22: persistRawRequisition() now needs its INSERT's RETURNING
      // id/fetched_at to compute a diff against -- see the identical note in
      // greenhouseProvider.test.ts's fakePool().
      let rawRowCounter = 0;
      const pool = {
        query: vi.fn(async (...args: unknown[]) => {
          calls.push(args);
          const sql = args[0] as string;
          if (sql.includes("INSERT INTO raw_requisitions")) {
            rawRowCounter += 1;
            return { rows: [{ id: `fake-raw-${rawRowCounter}`, fetched_at: new Date().toISOString() }] };
          }
          return { rows: [] };
        }),
      } as unknown as Pool;

      const provider = new GreenhouseProvider(pool, ["gitlab"]);
      const signals = await provider.fetchSignals({ timeoutMs: 10_000 });

      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0].source).toBe("greenhouse");
      expect(signals[0].company).toBe("GitLab");

      const rawInsertCalls = calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_requisitions"),
      );
      // >=, not ===: raw persists for every job fetched, parsed signals
      // only for jobs that parsed cleanly -- on real live data these should
      // match, but this test shouldn't flake if one real job ever has an
      // unparseable date.
      expect(rawInsertCalls.length).toBeGreaterThanOrEqual(signals.length);
    },
    15_000,
  );
});
