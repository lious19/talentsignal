import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { FormDProvider } from "../src/adapters/formDProvider";

const FIXTURE_ZIP = readFileSync(path.join(__dirname, "fixtures/formd/sample.zip"));

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

function stubFetchWithZip() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => FIXTURE_ZIP.buffer.slice(FIXTURE_ZIP.byteOffset, FIXTURE_ZIP.byteOffset + FIXTURE_ZIP.byteLength),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Fixture (tests/fixtures/formd/sample.zip): ISSUERS.tsv has GITLAB INC.
// (real sale, 2026-05-01), UNRELATED HOLDINGS LLC (yet to occur), ACME CORP
// (real sale, 2026-04-15) -- joined to OFFERING.tsv by ACCESSIONNUMBER.
describe("FormDProvider", () => {
  it("uses the real field names -- ENTITYNAME and SALE_DATE, not dateOfFirstSale", async () => {
    stubFetchWithZip();
    const { pool } = fakePool();
    const provider = new FormDProvider(pool, ["GitLab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([{ source: "form-d", employerNameRaw: "GITLAB INC.", eventDate: "2026-05-01" }]);
  });

  it("reports null eventDate for a YETTOOCCUR offering", async () => {
    stubFetchWithZip();
    const { pool } = fakePool();
    const provider = new FormDProvider(pool, ["Unrelated"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([{ source: "form-d", employerNameRaw: "UNRELATED HOLDINGS LLC", eventDate: null }]);
  });

  it("ignores issuers that don't match any target company", async () => {
    stubFetchWithZip();
    const { pool } = fakePool();
    const provider = new FormDProvider(pool, ["NoSuchCompany"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([]);
  });

  it("persists a raw row for every matched issuer", async () => {
    stubFetchWithZip();
    const { pool, calls } = fakePool();
    const provider = new FormDProvider(pool, ["GitLab", "Acme"]);

    await provider.fetchSignals({ timeoutMs: 5000 });

    const inserts = calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_capacity_signals"),
    );
    expect(inserts).toHaveLength(2);
  });

  it("returns no signals when the zip download fails, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const { pool } = fakePool();
    const provider = new FormDProvider(pool, ["GitLab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 5000 });

    expect(signals).toEqual([]);
  });
});
