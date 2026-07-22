import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the backend as reachable when /api/health resolves ok (happy path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok", db: "ok" }),
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Backend reachable/i)).toBeInTheDocument(),
    );
  });

  it("shows an unreachable message when the fetch fails (failure path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Backend unreachable/i)).toBeInTheDocument(),
    );
  });
});
