import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeOpportunitiesPool } from "./helpers/fakeOpportunitiesPool";
import { salesAuthHeader } from "./helpers/authHeader";
import type { MarketSignal, MarketSignalProvider } from "../src/adapters/marketSignalProvider";

/**
 * TRUST (S-04, REQ-020): "the platform never contacts a client on its own."
 * There is no outbound-capable code anywhere in backend/src yet (no
 * fetch/http(s).request/axios/nodemailer references at all), so this can't
 * test a specific release gate the way S-09 eventually will. What it CAN
 * prove now, and keep proving as the codebase grows, is a negative: running a
 * full analyze() request never causes anything to leave the process
 * outbound, regardless of mechanism.
 *
 * Deliberately watches https.request/https.get and global fetch, NOT plain
 * http — supertest drives this test by opening a real loopback HTTP
 * connection to the Express app on an ephemeral local port, so watching
 * http.request would flag the test harness's own traffic, not the
 * application. Anything actually leaving this platform for a real client (a
 * CRM, an email/SMS provider) goes out over HTTPS or fetch, never plain HTTP
 * to localhost, so excluding http doesn't weaken the guarantee under test.
 *
 * vi.spyOn can't redefine node:https's request/get directly — Node's builtin
 * module exports are non-configurable under Vitest's module interop — so
 * this mocks the whole module (keeping everything else real via
 * importOriginal) instead, which is Vitest's supported way to observe calls
 * into a Node core module.
 *
 * When S-09 adds real outbound capability behind the human-release boundary,
 * THIS test should start failing on that new code path — that failure is a
 * prompt to replace it with a stronger assertion ("outbound only happens
 * after an explicit release action"), not a reason to delete this test.
 */
const httpsRequestSpy = vi.fn();
const httpsGetSpy = vi.fn();

vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return {
    ...actual,
    request: (...args: unknown[]) => {
      httpsRequestSpy(...args);
      return {} as never;
    },
    get: (...args: unknown[]) => {
      httpsGetSpy(...args);
      return {} as never;
    },
  };
});

const SIGNAL: MarketSignal = {
  source: "mock-job-board",
  externalId: "jb-1001",
  company: "Acme Corp",
  title: "Senior Recruiter",
  daysOpen: 24,
  isRepost: true,
  hasSalaryRange: false,
};

function fixedProvider(signals: MarketSignal[]): MarketSignalProvider {
  return { fetchSignals: async () => signals };
}

describe("TRUST — hidden-demand analyze never contacts anything outbound", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    httpsRequestSpy.mockClear();
    httpsGetSpy.mockClear();
  });

  it("a full batch analyze + list round trip makes zero outbound calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Import after mocks are registered so createApp's dependency graph
    // resolves against the mocked node:https.
    const { createApp } = await import("../src/app");
    const { pool } = createFakeOpportunitiesPool();
    const signals = Array.from({ length: 50 }, (_, i) => ({ ...SIGNAL, externalId: `jb-${i}` }));
    const app = createApp(pool, fixedProvider(signals));

    const analyzeRes = await request(app)
      .post("/api/hidden-demand/analyze")
      .set("Authorization", salesAuthHeader());
    const listRes = await request(app)
      .get("/api/hidden-demand/opportunities")
      .set("Authorization", salesAuthHeader());

    expect(analyzeRes.status).toBe(201);
    expect(listRes.status).toBe(200);
    expect(httpsRequestSpy).not.toHaveBeenCalled();
    expect(httpsGetSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
