import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeOpportunityPackagePool } from "./helpers/fakeOpportunityPackagePool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-09, REQ-020, THE keystone story): "the platform drafts, it never
 * sends" AND "release requires an explicit human action" — both halves at
 * once. Same technique as salesPipeline.noOutbound.trust.test.ts and
 * hiddenDemand.noOutbound.trust.test.ts: mock node:https and global fetch,
 * because supertest's own loopback traffic uses plain http, so anything that
 * actually left this platform would have to go out over https or fetch.
 *
 * Unlike S-08, opportunityPackage.ts has NO notifier at all — there is
 * nothing here even shaped like an outbound seam. This proves the stronger
 * claim the whole story rests on: nothing leaves on draft, and nothing
 * leaves on release either, because no delivery path exists in this story's
 * code, full stop.
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

describe("TRUST — opportunity package draft and release never contact anything outbound", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    httpsRequestSpy.mockClear();
    httpsGetSpy.mockClear();
  });

  it("a draft + release + list round trip makes zero outbound calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Import after mocks are registered so createApp's dependency graph
    // resolves against the mocked node:https.
    const { createApp } = await import("../src/app");
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const draftRes = await request(app)
      .post("/api/opportunity-package/draft")
      .set("Authorization", salesAuthHeader())
      .send({ opportunityId: opportunity.id, jobOpeningId: job.id });
    const releaseRes = await request(app)
      .post(`/api/opportunity-package/${draftRes.body.package.id}/release`)
      .set("Authorization", salesAuthHeader());
    const listRes = await request(app)
      .get("/api/opportunity-packages")
      .set("Authorization", salesAuthHeader());

    expect(draftRes.status).toBe(201);
    expect(draftRes.body.package.status).toBe("draft");
    expect(draftRes.body.package.aiGenerated).toBe(true);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.package.status).toBe("released");
    expect(listRes.status).toBe(200);
    expect(httpsRequestSpy).not.toHaveBeenCalled();
    expect(httpsGetSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
