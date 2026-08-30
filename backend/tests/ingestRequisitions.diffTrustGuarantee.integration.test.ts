import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import ghT1 from "./fixtures/greenhouse/multi-run/t1.json";
import ghT2 from "./fixtures/greenhouse/multi-run/t2.json";
import ghT3 from "./fixtures/greenhouse/multi-run/t3.json";

/**
 * Section 9's trust guarantee: raw_requisitions holds enough evidence that a
 * BUGGY differ run's wrong output is recoverable -- not by trusting the
 * buggy run's own numbers, but by re-running a correct differ over the same
 * untouched raw history. This proves repost_count is a genuinely
 * RE-DERIVABLE function of raw_requisitions, not a value that, once wrong,
 * stays wrong.
 *
 * Sequence: t1 (item present) -> t2 (item absent, board polled for others)
 * -> t3 with a DELIBERATELY CORRUPTED differ (always reports repostCount 0)
 * -> assert opportunities is wrong -> re-run t3 with the REAL differ,
 * asserting opportunities self-corrects to the right answer (1), using only
 * raw_requisitions rows that already existed -- no new information, just a
 * correct recomputation.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function stubFetchWithFixture(gh: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return { ok: true, status: 200, json: async () => gh };
      }
      throw new Error(`unexpected fetch URL in test: ${url}`);
    }),
  );
}

describeIfDb("S-22 diff trust guarantee (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_diff_trust_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../src/ingestion/computeDiffs");
    vi.resetModules();
  });

  it(
    "a corrupted differ's wrong repost_count self-corrects on a later correct run over the same raw history",
    async () => {
      // Run 1 (t1) and run 2 (t2, item 9000003 absent) with the REAL differ
      // -- establishes the raw history a repost detection depends on.
      const { GreenhouseProvider } = await import("../src/adapters/greenhouseProvider");
      const { LeverProvider } = await import("../src/adapters/leverProvider");
      const { ingestRequisitions } = await import("../src/ingestion/ingestRequisitions");

      const realProviders = () => ({
        greenhouse: new GreenhouseProvider(scopedPool, ["gitlab"]),
        lever: new LeverProvider(scopedPool, []),
      });

      stubFetchWithFixture(ghT1);
      await ingestRequisitions(scopedPool, realProviders(), { timeoutMs: 5000 });
      stubFetchWithFixture(ghT2);
      await ingestRequisitions(scopedPool, realProviders(), { timeoutMs: 5000 });

      // Run 3 (t3, item 9000003 reappears): CORRUPTED differ, always reports
      // no repost regardless of history.
      vi.resetModules();
      vi.doMock("../src/ingestion/computeDiffs", () => ({
        computeDiff: vi.fn(async () => ({ repostCount: 0, daysOpen: 0, descriptionChurn: 0 })),
        normalizeChurnText: (s: string) => s,
      }));
      const corrupted = await import("../src/adapters/greenhouseProvider");
      const corruptedIngest = await import("../src/ingestion/ingestRequisitions");
      const leverForCorrupted = await import("../src/adapters/leverProvider");

      stubFetchWithFixture(ghT3);
      await corruptedIngest.ingestRequisitions(
        scopedPool,
        {
          greenhouse: new corrupted.GreenhouseProvider(scopedPool, ["gitlab"]),
          lever: new leverForCorrupted.LeverProvider(scopedPool, []),
        },
        { timeoutMs: 5000 },
      );

      const { rows: wrongRows } = await scopedPool.query(
        `SELECT repost_count FROM opportunities WHERE external_signal_id = '9000003'`,
      );
      // The corrupted differ's wrong answer landed in opportunities.
      expect(wrongRows[0].repost_count).toBe(0);

      // Re-run t3 again, this time with the REAL differ restored -- no new
      // information beyond what raw_requisitions already held (t1/t2's real
      // rows, plus the corrupted run's own raw row, which is still a
      // perfectly valid raw capture -- only its DIFF was wrong, not its raw
      // persistence).
      vi.doUnmock("../src/ingestion/computeDiffs");
      vi.resetModules();
      const real = await import("../src/adapters/greenhouseProvider");
      const realIngest = await import("../src/ingestion/ingestRequisitions");
      const leverForReal = await import("../src/adapters/leverProvider");

      stubFetchWithFixture(ghT3);
      await realIngest.ingestRequisitions(
        scopedPool,
        {
          greenhouse: new real.GreenhouseProvider(scopedPool, ["gitlab"]),
          lever: new leverForReal.LeverProvider(scopedPool, []),
        },
        { timeoutMs: 5000 },
      );

      const { rows: correctedRows } = await scopedPool.query(
        `SELECT repost_count FROM opportunities WHERE external_signal_id = '9000003'`,
      );
      // Self-corrected to the right answer, purely by recomputing from
      // raw_requisitions -- the trust guarantee this test exists to prove.
      expect(correctedRows[0].repost_count).toBe(1);
    },
    30_000,
  );
});
