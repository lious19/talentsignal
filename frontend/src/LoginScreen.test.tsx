import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";

describe("LoginScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("happy path: stores the token and calls onSuccess", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: "real-token", user: { id: "1", email: "a@example.com", role: "sales" } }),
      }),
    );
    const onSuccess = vi.fn();

    render(<LoginScreen onSuccess={onSuccess} onSwitchToRegister={() => {}} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("real-token"));
    expect(localStorage.getItem("ts_token")).toBe("real-token");
  });

  it("failure: shows the real error from the API and never calls onSuccess", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid email or password" }),
      }),
    );
    const onSuccess = vi.fn();

    render(<LoginScreen onSuccess={onSuccess} onSwitchToRegister={() => {}} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("invalid email or password"));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem("ts_token")).toBeNull();
  });

  it("shows a generic message when the network request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<LoginScreen onSuccess={() => {}} onSwitchToRegister={() => {}} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network error/i));
  });
});
