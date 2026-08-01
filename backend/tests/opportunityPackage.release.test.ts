import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunityPackagePool } from "./helpers/fakeOpportunityPackagePool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader, recruiterAuthHeader } from "./helpers/authHeader";

async function draftPackage(app: ReturnType<typeof createApp>, opportunityId: string, jobId: string) {
  return request(app)
    .post("/api/opportunity-package/draft")
    .set("Authorization", salesAuthHeader())
    .send({ opportunityId, jobOpeningId: jobId });
}

describe("POST /api/opportunity-package/:id/release", () => {
  it("TRUST — a drafted package is never released until an explicit human POST, and records actor + timestamp", async () => {
    const { pool, seedOpportunity, seedJobOpening, releaseAudit } =
      createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);

    const draftRes = await draftPackage(app, opportunity.id, job.id);
    expect(draftRes.body.package.status).toBe("draft");
    expect(draftRes.body.package.releasedBy).toBeNull();
    expect(draftRes.body.package.releasedAt).toBeNull();

    const releaseRes = await request(app)
      .post(`/api/opportunity-package/${draftRes.body.package.id}/release`)
      .set("Authorization", recruiterAuthHeader());

    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.package.status).toBe("released");
    // recruiterAuthHeader signs sub "user-2" — see tests/helpers/authHeader.ts.
    expect(releaseRes.body.package.releasedBy).toBe("user-2");
    expect(typeof releaseRes.body.package.releasedAt).toBe("string");

    expect(releaseAudit).toHaveLength(1);
    expect(releaseAudit[0].released_by).toBe("user-2");
    expect(releaseAudit[0].package_id).toBe(draftRes.body.package.id);
  });

  it("rejects an unauthenticated release request", async () => {
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);
    const draftRes = await draftPackage(app, opportunity.id, job.id);

    const res = await request(app).post(`/api/opportunity-package/${draftRes.body.package.id}/release`);

    expect(res.status).toBe(401);
  });

  it("returns 404 releasing a package that does not exist", async () => {
    const { pool } = createFakeOpportunityPackagePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/opportunity-package/does-not-exist/release")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(404);
  });

  it("idempotency: re-releasing an already-released package is rejected and does not overwrite the original actor/timestamp", async () => {
    const { pool, seedOpportunity, seedJobOpening, releaseAudit } =
      createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);
    const draftRes = await draftPackage(app, opportunity.id, job.id);
    const packageId = draftRes.body.package.id;

    const firstRelease = await request(app)
      .post(`/api/opportunity-package/${packageId}/release`)
      .set("Authorization", salesAuthHeader());
    expect(firstRelease.status).toBe(200);
    const originalReleasedBy = firstRelease.body.package.releasedBy;
    const originalReleasedAt = firstRelease.body.package.releasedAt;

    // A different user attempts to re-release — must not succeed and must
    // not overwrite who/when the FIRST release recorded.
    const secondRelease = await request(app)
      .post(`/api/opportunity-package/${packageId}/release`)
      .set("Authorization", recruiterAuthHeader());

    expect(secondRelease.status).toBe(409);
    expect(secondRelease.body.package.releasedBy).toBe(originalReleasedBy);
    expect(secondRelease.body.package.releasedAt).toBe(originalReleasedAt);
    expect(releaseAudit).toHaveLength(1);

    const listRes = await request(app)
      .get("/api/opportunity-packages")
      .set("Authorization", salesAuthHeader());
    expect(listRes.body.packages[0].releasedBy).toBe(originalReleasedBy);
    expect(listRes.body.packages[0].releasedAt).toBe(originalReleasedAt);
  });
});
