import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MatchScreen } from "./MatchScreen";

const JOB_OPENING = { id: "job-1", title: "Senior Recruiter" };

const CANDIDATE = {
  id: "cand-1",
  name: "Jordan Rivera",
  experience: 6,
  availability: "2 weeks notice",
  fitScore: 0.508,
  matchedSkills: ["react", "sql"],
  reasons: ["matched react, sql (2 of 3 requirements)", "6 years experience", "experience added to this rank"],
  rankDriver: "skills-plus-experience" as const,
};

function stubFetch(matchResponse: unknown | (() => Promise<unknown>)) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/job-openings")) {
        return { ok: true, status: 200, json: async () => ({ jobOpenings: [JOB_OPENING] }) };
      }
      if (url.includes("/api/client-matchmaking/match")) {
        if (typeof matchResponse === "function") return matchResponse();
        return matchResponse;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("MatchScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("runs a match and shows the suggestion banner with per-candidate rationale (trust scenario)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    stubFetch({ ok: true, status: 200, json: async () => ({ candidates: [CANDIDATE] }) });

    render(<MatchScreen />);

    await waitFor(() => expect(screen.getByText("Senior Recruiter")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Job opening"), { target: { value: "job-1" } });
    fireEvent.click(screen.getByRole("button", { name: /find candidates/i }));

    await waitFor(() => expect(screen.getByText("Jordan Rivera")).toBeInTheDocument());

    // Trust AC: labeled a suggestion, never a completed action.
    expect(screen.getByRole("note")).toHaveTextContent(/suggested ranking/i);
    expect(screen.getByRole("note")).toHaveTextContent(/nothing here has been sent to a client/i);

    const item = screen.getByText("Jordan Rivera").closest("li");
    expect(item).not.toBeNull();
    // Never a bare number: fit score, matched skills, and reasons all show
    // together, same transparency bar as OpportunitiesList.
    expect(item).toHaveTextContent("51% fit");
    expect(item).toHaveTextContent("matched: react, sql");
    expect(item).toHaveTextContent("6 years experience");
    expect(item).toHaveTextContent("availability: 2 weeks notice");
    expect(item).toHaveTextContent("experience added to this rank");
  });

  it("shows an error message when the match request fails", async () => {
    localStorage.setItem("ts_token", "fake-token");
    stubFetch(() => Promise.reject(new Error("network down")));

    render(<MatchScreen />);

    await waitFor(() => expect(screen.getByText("Senior Recruiter")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Job opening"), { target: { value: "job-1" } });
    fireEvent.click(screen.getByRole("button", { name: /find candidates/i }));

    await waitFor(() => expect(screen.getByText(/Could not run matchmaking/i)).toBeInTheDocument());
  });

  it("shows an expired-session message when the stored token is rejected", async () => {
    localStorage.setItem("ts_token", "fake-token");
    stubFetch({ ok: false, status: 401, json: async () => ({}) });

    render(<MatchScreen />);

    await waitFor(() => expect(screen.getByText("Senior Recruiter")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Job opening"), { target: { value: "job-1" } });
    fireEvent.click(screen.getByRole("button", { name: /find candidates/i }));

    await waitFor(() => expect(screen.getByText(/session has expired/i)).toBeInTheDocument());
  });
});
