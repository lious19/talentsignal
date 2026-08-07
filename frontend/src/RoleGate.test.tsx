import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoleGate } from "./RoleGate";
import { storeRole } from "./auth";

describe("RoleGate", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("renders its children when the stored role is on the allow list", () => {
    storeRole("admin");
    render(
      <RoleGate allow={["admin", "sales"]}>
        <p>Sales Pipeline</p>
      </RoleGate>,
    );

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
  });

  it("renders nothing when the stored role is not on the allow list", () => {
    storeRole("recruiter");
    render(
      <RoleGate allow={["admin", "sales"]}>
        <p>Sales Pipeline</p>
      </RoleGate>,
    );

    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
  });

  it("renders nothing when no role is stored at all", () => {
    render(
      <RoleGate allow={["admin", "sales"]}>
        <p>Sales Pipeline</p>
      </RoleGate>,
    );

    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
  });
});
