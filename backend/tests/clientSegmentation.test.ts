import { describe, expect, it } from "vitest";
import { segmentClients } from "../src/scoring/clientSegmentation";
import { SEGMENTATION_CONFIG } from "../src/scoring/segmentationConfig";

describe("segmentClients", () => {
  it("groups clients into low/medium/high by open job_openings count", () => {
    const clients = [
      { id: "c1", name: "Zero Roles Co" },
      { id: "c2", name: "One Role Co" },
      { id: "c3", name: "Medium Co" },
      { id: "c4", name: "Busy Co" },
    ];
    const counts = new Map([
      ["c2", 1],
      ["c3", 3],
      ["c4", 6],
    ]);

    const groups = segmentClients(clients, counts);
    const bySegment = Object.fromEntries(groups.map((g) => [g.segment, g.clients.map((c) => c.id)]));

    // Most-open-roles-first within a bucket (byOpenRolesThenName) — c2 (1
    // open role) sorts ahead of c1 (0) even though both land in "low".
    expect(bySegment.low).toEqual(["c2", "c1"]);
    expect(bySegment.medium).toEqual(["c3"]);
    expect(bySegment.high).toEqual(["c4"]);
  });

  it("a client with no job_openings row at all defaults to zero, not missing", () => {
    const groups = segmentClients([{ id: "c1", name: "No Roles" }], new Map());
    expect(groups).toEqual([{ segment: "low", clients: [{ id: "c1", name: "No Roles", openRoles: 0 }] }]);
  });

  it("omits empty buckets rather than returning them with an empty clients array", () => {
    const groups = segmentClients([{ id: "c1", name: "Low Only" }], new Map());
    expect(groups.map((g) => g.segment)).toEqual(["low"]);
  });

  it("respects the configured threshold boundaries exactly", () => {
    const clients = [
      { id: "c1", name: "A" },
      { id: "c2", name: "B" },
      { id: "c3", name: "C" },
    ];
    const counts = new Map([
      ["c1", SEGMENTATION_CONFIG.thresholds.medium - 1],
      ["c2", SEGMENTATION_CONFIG.thresholds.medium],
      ["c3", SEGMENTATION_CONFIG.thresholds.high],
    ]);

    const groups = segmentClients(clients, counts);
    const bySegment = Object.fromEntries(groups.map((g) => [g.segment, g.clients.map((c) => c.id)]));

    expect(bySegment.low).toEqual(["c1"]);
    expect(bySegment.medium).toEqual(["c2"]);
    expect(bySegment.high).toEqual(["c3"]);
  });

  it("advisory-only by construction: output is plain data, never a targeting decision", () => {
    // No assertion beyond the shape itself — segmentClients has no I/O and
    // no side effects, so there is nothing here to spy on. This documents
    // the trust property structurally: the function signature is (clients,
    // counts) -> groups, nothing more.
    const groups = segmentClients([], new Map());
    expect(groups).toEqual([]);
  });

  it("empty client list returns no groups", () => {
    expect(segmentClients([], new Map())).toEqual([]);
  });
});
