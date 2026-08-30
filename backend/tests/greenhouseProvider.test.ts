import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { GreenhouseProvider } from "../src/adapters/greenhouseProvider";
import fixture from "./fixtures/greenhouse/gitlab.json";

// S-22: GreenhouseProvider now calls computeDiff() after persisting each raw
// row, which needs the INSERT's RETURNING id/fetched_at to have something to
// read. Every OTHER query (computeDiff's history/gap-window reads) still
// returns {rows: []} -- "no prior history" is the correct, first-sighting
// behavior these existing unit tests already assert (isRepost: false).
function fakePool() {
  const calls: unknown[][] = [];
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
  return { pool, calls };
}

function stubFetch(handler: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GreenhouseProvider", () => {
  it("parses real fixtured jobs into MarketSignal shape", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const { pool } = fakePool();
    const provider = new GreenhouseProvider(pool, ["gitlab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toHaveLength(4);
    expect(signals[0]).toMatchObject({
      source: "greenhouse",
      externalId: "8503792002",
      company: "GitLab",
      title: "Account Executive - Italy",
      isRepost: false,
      hasSalaryRange: false,
    });
    expect(signals[0].daysOpen).toBeGreaterThanOrEqual(0);
  });

  it("persists the raw response for every job before returning parsed signals", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const { pool, calls } = fakePool();
    const provider = new GreenhouseProvider(pool, ["gitlab"]);

    await provider.fetchSignals({ timeoutMs: 5000 });

    const rawInsertCalls = calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_requisitions"),
    );
    expect(rawInsertCalls).toHaveLength(4);
  });

  it("isolates a bad board from a good one (acceptance criterion 4)", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("bad-token")) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => fixture };
    });
    const { pool } = fakePool();
    const provider = new GreenhouseProvider(pool, ["bad-token", "gitlab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    // Only gitlab's 4 jobs made it through -- bad-token's failure didn't
    // blank out the rest of the run.
    expect(signals).toHaveLength(4);
  });

  it("an unexpected response shape fails that board without throwing out of fetchSignals", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ notJobs: true }) }));
    const { pool } = fakePool();
    const provider = new GreenhouseProvider(pool, ["weird-shape"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([]);
  });

  it("trust guarantee: a parse failure on one job still persists that job's raw response, and doesn't stop the next job in the same board", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const { pool, calls } = fakePool();
    const provider = new GreenhouseProvider(pool, ["gitlab"]);

    // Break first_published on the second fixtured job only, so
    // toMarketSignal()'s date parsing throws for exactly one job.
    const corrupted = {
      jobs: fixture.jobs.map((job, i) => (i === 1 ? { ...job, first_published: null } : job)),
    };
    stubFetch(async () => ({ ok: true, status: 200, json: async () => corrupted }));

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    // 3 of 4 jobs parsed successfully; the corrupted one is missing from
    // the parsed output...
    expect(signals).toHaveLength(3);
    expect(signals.some((s) => s.externalId === String(fixture.jobs[1].id))).toBe(false);

    // ...but its raw response was still persisted -- every job, including
    // the one that failed to parse, got a raw_requisitions insert.
    const rawInsertCalls = calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_requisitions"),
    );
    expect(rawInsertCalls).toHaveLength(4);
    const persistedExternalIds = rawInsertCalls.map(([, params]) => (params as unknown[])[1]);
    expect(persistedExternalIds).toContain(String(fixture.jobs[1].id));
  });
});
