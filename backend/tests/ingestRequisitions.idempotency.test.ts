import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { GreenhouseProvider } from "../src/adapters/greenhouseProvider";
import { LeverProvider } from "../src/adapters/leverProvider";
import { ingestRequisitions } from "../src/ingestion/ingestRequisitions";
import greenhouseFixture from "./fixtures/greenhouse/gitlab.json";
import leverFixture from "./fixtures/lever/gopuff.json";

/**
 * Acceptance criterion 3: "a second run over the same board creates no
 * duplicate rows (idempotent on source + external id)." A fake pool can't
 * prove real Postgres ON CONFLICT behavior, so this needs a genuine
 * database, same describeIfDb gate as every other *.integration.test.ts
 * file (e.g. seedDemo.idempotent.integration.test.ts).
 *
 * Network calls are mocked (fixtures), the database is real -- same split
 * S-19's integration tests already use for everything except the one
 * guarded live-network test.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function stubFetchWithFixtures() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return { ok: true, status: 200, json: async () => greenhouseFixture };
      }
      if (url.includes("api.lever.co")) {
        return { ok: true, status: 200, json: async () => leverFixture };
      }
      throw new Error(`unexpected fetch URL in test: ${url}`);
    }),
  );
}

describeIfDb("ingestRequisitions idempotency (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_ingest_idem_${randomUUID().replace(/-/g, "_")}`;
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
    "parsed opportunities stay flat on a second run; raw_requisitions grows, by design",
    async () => {
      const providers = () => ({
        greenhouse: new GreenhouseProvider(scopedPool, ["gitlab"]),
        lever: new LeverProvider(scopedPool, ["gopuff"]),
      });

      stubFetchWithFixtures();
      const first = await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });
      expect(first.opportunitiesUpserted).toBe(8); // 4 greenhouse + 4 lever fixtured items

      const { rows: rawFirst } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM raw_requisitions",
      );
      const { rows: oppFirst } = await scopedPool.query(
        "SELECT id, source, external_signal_id FROM opportunities ORDER BY source, external_signal_id",
      );

      stubFetchWithFixtures();
      const second = await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });
      expect(second.opportunitiesUpserted).toBe(8);

      const { rows: rawSecond } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM raw_requisitions",
      );
      const { rows: oppSecond } = await scopedPool.query(
        "SELECT id, source, external_signal_id FROM opportunities ORDER BY source, external_signal_id",
      );

      // Parsed side: idempotent -- same rows, same ids, per opportunities'
      // existing UNIQUE(source, external_signal_id) + upsertBatch's ON
      // CONFLICT DO UPDATE. This is the literal "no duplicate rows" the
      // acceptance criterion asks for.
      expect(oppSecond).toEqual(oppFirst);

      // Raw side: intentionally NOT deduped -- append-only by design
      // (Megan's amendment 4 / decision 041), since S-22's diffing needs
      // fetch-to-fetch history. A second run adds one row per item; that's
      // a new, distinct historical snapshot at a new fetched_at, not a
      // "duplicate" in the sense criterion 3 is about (which is scoped to
      // the parsed/opportunities side).
      expect(rawSecond[0].n).toBe(rawFirst[0].n * 2);
    },
    30_000,
  );
});
