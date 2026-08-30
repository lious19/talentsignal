import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { GreenhouseProvider } from "../src/adapters/greenhouseProvider";
import { LeverProvider } from "../src/adapters/leverProvider";
import { ingestRequisitions } from "../src/ingestion/ingestRequisitions";
import ghT1 from "./fixtures/greenhouse/multi-run/t1.json";
import ghT2 from "./fixtures/greenhouse/multi-run/t2.json";
import ghT3 from "./fixtures/greenhouse/multi-run/t3.json";
import lvT1 from "./fixtures/lever/multi-run/t1.json";
import lvT2 from "./fixtures/lever/multi-run/t2.json";
import lvT3 from "./fixtures/lever/multi-run/t3.json";

/**
 * S-22's four acceptance criteria, proven against a real database across
 * THREE sequential ingestion runs -- the gap the ticket itself flagged:
 * existing single-shot fixtures can't exercise "disappears and later
 * returns." Each fixture pair encodes:
 *   - item A: present, unchanged, in every run (no-op -- criterion 3)
 *   - item B: present in every run, title/description edited between
 *     t1 and t2, unchanged after (churn without repost -- criterion 2)
 *   - item C: present t1, ABSENT from t2 (board still returns A/B, just not
 *     C), present again t3 (repost -- criterion 1)
 * A separate empty-response run proves criterion 4 in isolation.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function stubFetchWithFixtures(gh: unknown, lv: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return { ok: true, status: 200, json: async () => gh };
      }
      if (url.includes("api.lever.co")) {
        return { ok: true, status: 200, json: async () => lv };
      }
      throw new Error(`unexpected fetch URL in test: ${url}`);
    }),
  );
}

describeIfDb("S-22 longitudinal diffing (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_diff_${randomUUID().replace(/-/g, "_")}`;
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
    "criteria 1-3: repost, churn without repost, and a no-op across three real runs",
    async () => {
      const providers = () => ({
        greenhouse: new GreenhouseProvider(scopedPool, ["gitlab"]),
        lever: new LeverProvider(scopedPool, ["gopuff"]),
      });

      stubFetchWithFixtures(ghT1, lvT1);
      await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });

      stubFetchWithFixtures(ghT2, lvT2);
      await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });

      stubFetchWithFixtures(ghT3, lvT3);
      await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });

      const { rows } = await scopedPool.query(
        `SELECT external_signal_id, title, repost_count, description_churn
           FROM opportunities WHERE source IN ('greenhouse', 'lever')
           ORDER BY source, external_signal_id`,
      );
      const bySignal = Object.fromEntries(rows.map((r) => [r.external_signal_id, r]));

      // Item A (unchanged every run): criterion 3 -- a no-op across
      // repeated, identical fetches.
      expect(bySignal["9000001"]).toMatchObject({ repost_count: 0, description_churn: 0 });
      expect(bySignal["lvr-a1"]).toMatchObject({ repost_count: 0, description_churn: 0 });

      // Item B (title/description edited between t1 and t2, then stable):
      // criterion 2 -- churn increments, repost does not.
      expect(bySignal["9000002"]).toMatchObject({
        title: "Senior Support Engineer",
        repost_count: 0,
        description_churn: 1,
      });
      expect(bySignal["lvr-b1"]).toMatchObject({ repost_count: 0, description_churn: 1 });

      // Item C (present t1, absent t2, present t3): criterion 1 -- detected
      // as a repost, not a new record (same opportunity row, not two).
      expect(bySignal["9000003"]).toMatchObject({ repost_count: 1 });
      expect(bySignal["lvr-c1"]).toMatchObject({ repost_count: 1 });

      const { rows: countRows } = await scopedPool.query(
        `SELECT count(*)::int AS n FROM opportunities WHERE external_signal_id IN ('9000003', 'lvr-c1')`,
      );
      // Reappearing is a repost on the SAME row, not a second, "new" record.
      expect(countRows[0].n).toBe(2);
    },
    30_000,
  );

  it(
    "criterion 4: a board returning zero postings does not zero out existing history",
    async () => {
      const providers = () => ({
        greenhouse: new GreenhouseProvider(scopedPool, ["gitlab"]),
        lever: new LeverProvider(scopedPool, ["gopuff"]),
      });

      stubFetchWithFixtures(ghT1, lvT1);
      await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });

      const { rows: before } = await scopedPool.query(
        `SELECT external_signal_id, days_open, repost_count, description_churn
           FROM opportunities WHERE source IN ('greenhouse', 'lever')
           ORDER BY source, external_signal_id`,
      );
      expect(before.length).toBeGreaterThan(0);

      // Both boards return zero postings this run -- the empty-response
      // boundary (06_decisions/043/045).
      stubFetchWithFixtures({ jobs: [] }, []);
      const emptyRun = await ingestRequisitions(scopedPool, providers(), { timeoutMs: 5000 });
      expect(emptyRun.opportunitiesUpserted).toBe(0);

      const { rows: after } = await scopedPool.query(
        `SELECT external_signal_id, days_open, repost_count, description_churn
           FROM opportunities WHERE source IN ('greenhouse', 'lever')
           ORDER BY source, external_signal_id`,
      );
      // Nothing zeroed, nothing lost -- an empty response touches no row.
      expect(after).toEqual(before);
    },
    30_000,
  );
});
