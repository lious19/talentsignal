import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegisterScreen } from "./RegisterScreen";

function fillForm() {
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "new@example.com" } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "correct-horse-battery" } });
}

describe("RegisterScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("happy path: registers, logs in automatically, stores the token, and calls onSuccess", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", email: "new@example.com", role: "sales" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "real-token", user: { id: "1", email: "new@example.com", role: "sales" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();

    render(<RegisterScreen onSuccess={onSuccess} onSwitchToLogin={() => {}} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /register/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("real-token"));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/register", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/login", expect.anything());
    expect(localStorage.getItem("ts_token")).toBe("real-token");
  });

  it("failure: shows the real error on a duplicate email and never attempts login", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "an account with this email already exists" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();

    render(<RegisterScreen onSuccess={onSuccess} onSwitchToLogin={() => {}} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /register/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("an account with this email already exists"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
