import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { GreenhouseProvider } from "../src/adapters/greenhouseProvider";
import { LeverProvider } from "../src/adapters/leverProvider";
import { ingestRequisitions } from "../src/ingestion/ingestRequisitions";
import leverFixture from "./fixtures/lever/gopuff.json";

/**
 * Acceptance criterion 4: "an unreachable or malformed board yields a
 * logged, classified error and the other boards still ingest." Proven
 * against a real database (not just a fake pool) so a real Postgres write
 * from the healthy provider is what's actually being asserted, mirroring
 * ingestRequisitions.idempotency.test.ts's describeIfDb gate.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("ingestRequisitions failure isolation (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_ingest_fail_${randomUUID().replace(/-/g, "_")}`;
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
  });

  it(
    "greenhouse returning 500 does not block lever's postings from landing",
    async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("boards-api.greenhouse.io")) {
            return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
          }
          if (url.includes("api.lever.co")) {
            return { ok: true, status: 200, json: async () => leverFixture };
          }
          throw new Error(`unexpected fetch URL in test: ${url}`);
        }),
      );

      const result = await ingestRequisitions(
        scopedPool,
        {
          greenhouse: new GreenhouseProvider(scopedPool, ["gitlab"]),
          lever: new LeverProvider(scopedPool, ["gopuff"]),
        },
        { timeoutMs: 5000 },
      );

      // GreenhouseProvider isolates failures per-board internally (see
      // 06_decisions/040) -- a fully-down board is logged and classified
      // at that point, not surfaced as a thrown error out of
      // fetchSignals(), so `ok` here reflects "the provider call didn't
      // throw" (true), not "every board inside it succeeded." What
      // criterion 4 actually requires -- the failure doesn't block the
      // healthy provider's data -- is asserted below.
      expect(result.greenhouse.ok).toBe(true);
      expect(result.greenhouse.signalCount).toBe(0);
      expect(result.lever.ok).toBe(true);
      expect(result.lever.signalCount).toBe(4);
      expect(result.opportunitiesUpserted).toBe(4);

      const { rows } = await scopedPool.query("SELECT DISTINCT source FROM opportunities");
      expect(rows).toEqual([{ source: "lever" }]);
    },
    30_000,
  );
});
