import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeMatchmakingPool } from "./helpers/fakeMatchmakingPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-06, REQ-020): "A human decides, the platform suggests." There is
 * no "submit to client" endpoint anywhere in backend/src yet (that's S-09's
 * human-release gate), so — same reasoning as
 * hiddenDemand.noOutbound.trust.test.ts — this can't test a specific release
 * gate. What it CAN prove now, and keep proving as the codebase grows, is a
 * negative: running a full match request never causes anything to leave the
 * process outbound, regardless of mechanism, AND the response itself is
 * labeled a suggestion rather than a completed action.
 *
 * Watches https.request/https.get and global fetch, not plain http, for the
 * same reason as S-04's trust test: supertest drives this test over a real
 * loopback HTTP connection, so watching http.request would flag the test
 * harness's own traffic rather than the application.
 *
 * When S-09 adds a real "submit to client" capability behind the
 * human-release boundary, THIS test should start failing on that new code
 * path — that expected failure is the prompt to replace it with a stronger
 * assertion ("outbound only happens after an explicit release action"), not
 * a reason to delete this test.
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

describe("TRUST — client matchmaking match never contacts anything outbound, and is labeled a suggestion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    httpsRequestSpy.mockClear();
    httpsGetSpy.mockClear();
  });

  it("a full match request makes zero outbound calls and labels the result a suggestion", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Import after mocks are registered so createApp's dependency graph
    // resolves against the mocked node:https.
    const { createApp } = await import("../src/app");
    const { pool, seedJobOpening, seedCandidate } = createFakeMatchmakingPool();
    const job = seedJobOpening({ requirements: ["react", "sql"] });
    seedCandidate({ name: "Alex", skills: ["react", "sql"], experience: 4 });

    const app = createApp(pool, noopProvider);
    const res = await request(app)
      .post("/api/client-matchmaking/match")
      .set("Authorization", salesAuthHeader())
      .send({ jobId: job.id });

    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBe(true);
    expect(res.body.candidates).toHaveLength(1);
    expect(httpsRequestSpy).not.toHaveBeenCalled();
    expect(httpsGetSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
