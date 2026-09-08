import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OpportunitiesList } from "./OpportunitiesList";

const OPPORTUNITY = {
  id: "opp-1",
  company: "Acme Corp",
  confidenceScore: 0.72,
  reasons: ["reposted role", "open 24 days", "no salary range"],
  source: "mock-job-board",
};

// HF-2: a flagged opportunity, shaped exactly like the backend response
// (hardToFill true + score/reasons/factors/version alongside confidence).
const HARD_TO_FILL_OPPORTUNITY = {
  ...OPPORTUNITY,
  id: "opp-htf",
  company: "Insight Analytics",
  hardToFill: true,
  hardToFillScore: 1.0,
  hardToFillReasons: ["in-demand role type", "open 30 days", "reposted role"],
  hardToFillVersion: "hard-to-fill-026-v1",
  hardToFillFactors: [
    { factor: "roleScarcity", weight: 0.6, value: 1, contribution: 0.6 },
    { factor: "daysOpen", weight: 0.2, value: 1, contribution: 0.2 },
    { factor: "repostedRole", weight: 0.2, value: 1, contribution: 0.2 },
  ],
};

describe("OpportunitiesList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows an expired-session message when no token is stored", async () => {
    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText(/session has expired/i)).toBeInTheDocument());
  });

  it("renders confidence, reasons, and source together for each opportunity (trust scenario)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ opportunities: [OPPORTUNITY] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const item = screen.getByText("Acme Corp").closest("li");
    expect(item).not.toBeNull();
    // Never a bare number: confidence, the plain-English reasons, and the
    // source all have to appear in the same list item.
    expect(item).toHaveTextContent("72% confidence");
    expect(item).toHaveTextContent("reposted role, open 24 days, no salary range");
    expect(item).toHaveTextContent("source: mock-job-board");
  });

  it("renders opportunities in the order the API returns them, numbered by rank (S-04)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    const first = { ...OPPORTUNITY, id: "opp-1", company: "High Co", confidenceScore: 0.9 };
    const second = { ...OPPORTUNITY, id: "opp-2", company: "Low Co", confidenceScore: 0.2 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        // Already ranked by the backend (confidence descending) — the
        // component trusts that order rather than re-sorting client-side.
        json: async () => ({ opportunities: [first, second] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("High Co")).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("#1");
    expect(items[0]).toHaveTextContent("High Co");
    expect(items[1]).toHaveTextContent("#2");
    expect(items[1]).toHaveTextContent("Low Co");
  });

  it("shows the factor breakdown and weights version for a scored opportunity (S-07 trust scenario)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    const withBreakdown = {
      ...OPPORTUNITY,
      weightsVersion: "confidence-007-v1",
      factors: [
        { factor: "baseScore", weight: 0.2, value: 1, contribution: 0.2 },
        { factor: "daysOpen", weight: 0.32, value: 0.8, contribution: 0.256 },
        { factor: "repostedRole", weight: 0.32, value: 1, contribution: 0.32 },
        { factor: "missingSalaryRange", weight: 0.16, value: 1, contribution: 0.16 },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ opportunities: [withBreakdown] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const item = screen.getByText("Acme Corp").closest("li");
    expect(item).toHaveTextContent("weights confidence-007-v1");
    expect(item).toHaveTextContent("baseScore: weight 0.2, value 1, contributes 0.2");
    expect(item).toHaveTextContent("repostedRole: weight 0.32, value 1, contributes 0.32");
  });

  it("shows an explicit fallback instead of a blank breakdown for a pre-S-07 opportunity", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        // No factors/weightsVersion at all — the shape a backfilled,
        // pre-S-07 row (or the old API response) would have.
        json: async () => ({ opportunities: [OPPORTUNITY] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const item = screen.getByText("Acme Corp").closest("li");
    expect(item).toHaveTextContent("No factor breakdown recorded (scored before S-07).");
  });

  it("shows an unauthenticated message when the stored token is rejected", async () => {
    localStorage.setItem("ts_token", "expired-or-invalid");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText(/session has expired/i)).toBeInTheDocument());
  });

  it("shows an error message when the request fails for another reason", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    render(<OpportunitiesList />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load opportunities/i)).toBeInTheDocument(),
    );
  });

  it("badges a hard-to-fill opportunity WITH its reason, never a bare badge (HF-2 trust)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ opportunities: [HARD_TO_FILL_OPPORTUNITY] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Insight Analytics")).toBeInTheDocument());
    const item = screen.getByText("Insight Analytics").closest("li");
    // The badge and its reason appear together — never a flag without the why.
    expect(item).toHaveTextContent("hard to fill: in-demand role type, open 30 days, reposted role");
  });

  it("shows NO hard-to-fill badge for an un-flagged opportunity", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ opportunities: [OPPORTUNITY] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const item = screen.getByText("Acme Corp").closest("li");
    expect(item).not.toHaveTextContent("hard to fill");
  });

  it("shows the hard-to-fill factor breakdown (HF-1 transparency carried through HF-2)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ opportunities: [HARD_TO_FILL_OPPORTUNITY] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Insight Analytics")).toBeInTheDocument());
    const item = screen.getByText("Insight Analytics").closest("li");
    expect(item).toHaveTextContent("Why hard to fill (weights hard-to-fill-026-v1)");
    expect(item).toHaveTextContent("roleScarcity: weight 0.6, value 1, contributes 0.6");
  });

  it("shows the roleScarcity basis (measured/curated) in the structured breakdown when present (S-23)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    const measuredOpportunity = {
      ...HARD_TO_FILL_OPPORTUNITY,
      id: "opp-measured",
      hardToFillVersion: "hard-to-fill-026-v2",
      hardToFillFactors: [
        {
          factor: "roleScarcity",
          weight: 0.6,
          value: 1,
          contribution: 0.6,
          basis: "measured",
          familyKey: "ml-ai",
          familyMedianDaysOpen: 69,
          globalMedianDaysOpen: 33,
        },
        { factor: "daysOpen", weight: 0.2, value: 1, contribution: 0.2, basis: "n/a" },
        { factor: "repostedRole", weight: 0.2, value: 1, contribution: 0.2, basis: "n/a" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ opportunities: [measuredOpportunity] }),
      }),
    );

    render(<OpportunitiesList />);

    await waitFor(() => expect(screen.getByText("Insight Analytics")).toBeInTheDocument());
    const item = screen.getByText("Insight Analytics").closest("li");
    // The structured breakdown never hides which evidence drove the score:
    // roleScarcity says "measured", the other two factors (basis "n/a") say nothing extra.
    expect(item).toHaveTextContent("roleScarcity: weight 0.6, value 1, contributes 0.6, basis: measured");
    expect(item).toHaveTextContent("daysOpen: weight 0.2, value 1, contributes 0.2");
    expect(item).not.toHaveTextContent("daysOpen: weight 0.2, value 1, contributes 0.2, basis");
  });
});
