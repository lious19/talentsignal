import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { LcaProvider } from "../src/adapters/lcaProvider";

const FIXTURE_PATH = path.join(__dirname, "fixtures/lca/sample.xlsx");

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

function stubFetchWithFixture() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      body: Readable.toWeb(createReadStream(FIXTURE_PATH)),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Fixture (tests/fixtures/lca/sample.xlsx), 4 rows: GITLAB INC. (Software
// Developers, SOC 15-1252), ACME WIDGETS LLC, GITLAB B.V., UNRELATED CO --
// generated once via exceljs's own streaming writer, same lib this provider
// reads with.
describe("LcaProvider", () => {
  it("streams the real column headers dynamically and only keeps rows matching a target company", async () => {
    stubFetchWithFixture();
    const { pool } = fakePool();
    const provider = new LcaProvider(pool, ["GitLab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 30000 });

    expect(signals).toHaveLength(2); // GITLAB INC. and GITLAB B.V.
    expect(signals.map((s) => s.employerNameRaw).sort()).toEqual(["GITLAB B.V.", "GITLAB INC."]);
    const gitlabInc = signals.find((s) => s.employerNameRaw === "GITLAB INC.");
    expect(gitlabInc).toMatchObject({
      source: "h1b-lca",
      roleTitle: "Senior Software Engineer",
      socCode: "15-1252",
    });
    expect(gitlabInc?.eventDate).toMatch(/^2025-10-15/);
  });

  it("persists a raw row only for the rows that passed the prefilter, not every row in the file", async () => {
    stubFetchWithFixture();
    const { pool, calls } = fakePool();
    const provider = new LcaProvider(pool, ["GitLab"]);

    await provider.fetchSignals({ timeoutMs: 30000 });

    const inserts = calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO raw_capacity_signals"),
    );
    // 2 GitLab rows out of 4 total in the fixture -- ACME/UNRELATED never
    // persisted, proving the deliberate prefilter-before-persist deviation
    // from decision 040 actually happens, not just documented.
    expect(inserts).toHaveLength(2);
  });

  it("returns no signals when no row matches any target company", async () => {
    stubFetchWithFixture();
    const { pool } = fakePool();
    const provider = new LcaProvider(pool, ["NoSuchCompany"]);

    const signals = await provider.fetchSignals({ timeoutMs: 30000 });

    expect(signals).toEqual([]);
  });

  it("returns no signals when the file download fails, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, body: null })));
    const { pool } = fakePool();
    const provider = new LcaProvider(pool, ["GitLab"]);

    const signals = await provider.fetchSignals({ timeoutMs: 30000 });

    expect(signals).toEqual([]);
  });
});
