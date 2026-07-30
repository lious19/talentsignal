import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeSalesPipelinePool } from "./helpers/fakeSalesPipelinePool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-08, REQ-020): "notifications fire but never leave the platform
 * without a human." Same negative-space discipline, and same technique, as
 * hiddenDemand.noOutbound.trust.test.ts: there is no outbound-capable code
 * anywhere in pipelineNotifier.ts (LoggingPipelineNotifier only ever calls
 * logger.info), so this proves a stage change never causes anything to leave
 * the process outbound, regardless of mechanism.
 *
 * Watches https.request/https.get and global fetch, not plain http, for the
 * same reason as the hidden-demand version: supertest's own loopback traffic
 * uses http, and anything actually leaving this platform would go out over
 * HTTPS or fetch.
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

describe("TRUST — sales pipeline stage change never contacts anything outbound", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    httpsRequestSpy.mockClear();
    httpsGetSpy.mockClear();
  });

  it("an enroll + transition + list round trip makes zero outbound calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Import after mocks are registered so createApp's dependency graph
    // resolves against the mocked node:https.
    const { createApp } = await import("../src/app");
    const { pool, seedClient } = createFakeSalesPipelinePool();
    const app = createApp(pool, noopProvider);
    const client = seedClient("Acme Corp");

    const enrollRes = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "prospecting" });
    const transitionRes = await request(app)
      .post("/api/sales-pipeline/update")
      .set("Authorization", salesAuthHeader())
      .send({ clientId: client.id, toStage: "contacted" });
    const listRes = await request(app)
      .get("/api/sales-pipeline")
      .set("Authorization", salesAuthHeader());

    expect(enrollRes.status).toBe(200);
    expect(transitionRes.status).toBe(200);
    expect(listRes.status).toBe(200);
    expect(httpsRequestSpy).not.toHaveBeenCalled();
    expect(httpsGetSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
