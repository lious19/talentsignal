import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { LeverProvider } from "../src/adapters/leverProvider";
import fixture from "./fixtures/lever/gopuff.json";

function fakePool() {
  const calls: unknown[][] = [];
  const pool = {
    query: vi.fn(async (...args: unknown[]) => {
      calls.push(args);
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

describe("LeverProvider", () => {
  it("parses real fixtured postings into MarketSignal shape", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const { pool } = fakePool();
    const provider = new LeverProvider(pool, ["gopuff"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toHaveLength(4);
    expect(signals[0]).toMatchObject({
      source: "lever",
      externalId: fixture[0].id,
      // Lever postings carry no company field -- derived from the config
      // handle, not the response body.
      company: "Gopuff",
      title: fixture[0].text,
      isRepost: false,
      hasSalaryRange: false,
    });
    expect(signals[0].daysOpen).toBeGreaterThanOrEqual(0);
  });

  it("persists the raw response for every posting before returning parsed signals", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const { pool, calls } = fakePool();
    const provider = new LeverProvider(pool, ["gopuff"]);

    await provider.fetchSignals({ timeoutMs: 5000 });

    const rawInsertCalls = calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_requisitions"),
    );
    expect(rawInsertCalls).toHaveLength(4);
  });

  it("isolates a bad company handle from a good one (acceptance criterion 4)", async () => {
    stubFetch(async (url: string) => {
      if (url.includes("bad-handle")) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => fixture };
    });
    const { pool } = fakePool();
    const provider = new LeverProvider(pool, ["bad-handle", "gopuff"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toHaveLength(4);
  });

  it("an unexpected response shape fails that board without throwing out of fetchSignals", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ notAnArray: true }) }));
    const { pool } = fakePool();
    const provider = new LeverProvider(pool, ["weird-shape"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([]);
  });
});
