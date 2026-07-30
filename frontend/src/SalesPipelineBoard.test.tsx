import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SalesPipelineBoard } from "./SalesPipelineBoard";

const PIPELINE_ENTRY = {
  id: "pipe-1",
  clientId: "client-1",
  clientName: "Acme Corp",
  status: "prospecting",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

const CLIENTS = [{ id: "client-1", name: "Acme Corp" }];

function stubFetch(pipeline: typeof PIPELINE_ENTRY[], clients = CLIENTS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales-pipeline/update") {
        const body = JSON.parse(String(init?.body)) as { clientId: string; toStage: string };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            pipeline: {
              id: "pipe-1",
              clientId: body.clientId,
              status: body.toStage,
              createdAt: "2026-07-30T00:00:00.000Z",
              updatedAt: "2026-07-30T01:00:00.000Z",
            },
            changed: true,
          }),
        } as Response;
      }
      if (url === "/api/sales-pipeline") {
        return { ok: true, status: 200, json: async () => ({ pipeline }) } as Response;
      }
      if (url === "/api/clients") {
        return { ok: true, status: 200, json: async () => ({ clients }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("SalesPipelineBoard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows an expired-session message when no token is stored", async () => {
    render(<SalesPipelineBoard />);
    await waitFor(() => expect(screen.getByText(/session has expired/i)).toBeInTheDocument());
  });

  it("renders the client under its current stage column", async () => {
    localStorage.setItem("ts_token", "fake-token");
    stubFetch([PIPELINE_ENTRY]);

    render(<SalesPipelineBoard />);

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const prospectingColumn = screen.getByLabelText("prospecting column");
    expect(prospectingColumn).toHaveTextContent("Acme Corp");
  });

  it("moves a card to the target column when a stage button is clicked (AC-4-5)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    stubFetch([PIPELINE_ENTRY]);

    render(<SalesPipelineBoard />);
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const prospectingColumn = screen.getByLabelText("prospecting column");
    const moveButton = prospectingColumn.querySelector("button")!;
    expect(moveButton).toHaveTextContent("Contacted");
    fireEvent.click(moveButton);

    await waitFor(() => {
      const contactedColumn = screen.getByLabelText("contacted column");
      expect(contactedColumn).toHaveTextContent("Acme Corp");
    });
    const prospectingAfter = screen.getByLabelText("prospecting column");
    expect(prospectingAfter).not.toHaveTextContent("Acme Corp");
  });
});
