import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { FederalAwardsProvider } from "../src/adapters/federalAwardsProvider";

function fakePool() {
  const calls: unknown[][] = [];
  const pool = {
    query: vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return { rows: [{ id: "fake-raw", fetched_at: new Date().toISOString() }] };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SEARCH_RESULT = {
  results: [{ "Recipient Name": "GITLAB INC.", generated_internal_id: "CONT_AWD_ABC_1" }],
};
const DETAIL_RESULT = {
  recipient: { recipient_name: "GITLAB INC." },
  period_of_performance: { start_date: "2016-07-20" },
};

describe("FederalAwardsProvider", () => {
  it("uses recipient_search_text, never keywords (Step 0's exact gotcha)", async () => {
    let capturedBody: string | undefined;
    stubFetch(async (url, init) => {
      if (url.includes("/search/spending_by_award/")) {
        capturedBody = init?.body as string;
        return { ok: true, status: 200, json: async () => SEARCH_RESULT };
      }
      return { ok: true, status: 200, json: async () => DETAIL_RESULT };
    });
    const { pool } = fakePool();
    const provider = new FederalAwardsProvider(pool, ["GitLab"]);

    await provider.fetchSignals({ timeoutMs: 5000 });

    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.filters.recipient_search_text).toEqual(["GitLab"]);
    expect(parsed.filters.keywords).toBeUndefined();
  });

  it("fetches the per-award detail endpoint for the real period-of-performance start date", async () => {
    let detailUrlCalled: string | undefined;
    stubFetch(async (url) => {
      if (url.includes("/search/spending_by_award/")) {
        return { ok: true, status: 200, json: async () => SEARCH_RESULT };
      }
      detailUrlCalled = url;
      return { ok: true, status: 200, json: async () => DETAIL_RESULT };
    });
    const { pool } = fakePool();
    const provider = new FederalAwardsProvider(pool, ["GitLab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(detailUrlCalled).toContain("/awards/CONT_AWD_ABC_1/");
    expect(signals).toEqual([
      { source: "federal-award", employerNameRaw: "GITLAB INC.", eventDate: "2016-07-20" },
    ]);
  });

  it("persists the raw award detail before returning parsed signals", async () => {
    stubFetch(async (url) => {
      if (url.includes("/search/spending_by_award/")) {
        return { ok: true, status: 200, json: async () => SEARCH_RESULT };
      }
      return { ok: true, status: 200, json: async () => DETAIL_RESULT };
    });
    const { pool, calls } = fakePool();
    const provider = new FederalAwardsProvider(pool, ["GitLab"]);

    await provider.fetchSignals({ timeoutMs: 5000 });

    const inserts = calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_capacity_signals"),
    );
    expect(inserts).toHaveLength(1);
  });

  it("isolates one company's search failure from another's real results", async () => {
    stubFetch(async (url, init) => {
      if (url.includes("/search/spending_by_award/")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.filters.recipient_search_text[0] === "BadCo") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => SEARCH_RESULT };
      }
      return { ok: true, status: 200, json: async () => DETAIL_RESULT };
    });
    const { pool } = fakePool();
    const provider = new FederalAwardsProvider(pool, ["BadCo", "GitLab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toHaveLength(1);
    expect(signals[0].employerNameRaw).toBe("GITLAB INC.");
  });

  it("returns no signals for a company with zero real awards", async () => {
    stubFetch(async (url) => {
      if (url.includes("/search/spending_by_award/")) {
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      }
      return { ok: true, status: 200, json: async () => DETAIL_RESULT };
    });
    const { pool } = fakePool();
    const provider = new FederalAwardsProvider(pool, ["gopuff"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([]);
  });
});
