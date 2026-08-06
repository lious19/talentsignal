import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForecastChart, type ForecastResult } from "./ForecastChart";

const OK_DATA: ForecastResult = {
  status: "ok",
  historical: [
    { month: "2026-01", count: 2, fitted: 2.1, residual: -0.1, isOutlier: false },
    { month: "2026-02", count: 8, fitted: 2.5, residual: 5.5, isOutlier: true },
    { month: "2026-03", count: 3, fitted: 2.9, residual: 0.1, isOutlier: false },
  ],
  forecast: [
    { month: "2026-04", predicted: 3.3, lowerBound: 1.3, upperBound: 5.3 },
    { month: "2026-05", predicted: 3.7, lowerBound: 1.7, upperBound: 5.7 },
  ],
};

describe("ForecastChart", () => {
  it("renders a graceful message, not a crash, when history is too short", () => {
    render(<ForecastChart data={{ status: "insufficient-history", monthsAvailable: 1, monthsRequired: 3 }} />);

    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
    expect(screen.getByText(/need at least 3 months, have 1/i)).toBeInTheDocument();
  });

  it("renders the chart with a confidence band and a marked outlier, not smoothed away", () => {
    render(<ForecastChart data={OK_DATA} />);

    expect(screen.getByRole("img", { name: /demand forecast/i })).toBeInTheDocument();
    expect(screen.getByLabelText("confidence band")).toBeInTheDocument();

    // The outlier month's original value (8) is preserved and marked, not
    // replaced by its fitted trend value (2.5) — the trust scenario, from
    // the chart's point of view.
    const outlierMarker = screen.getByLabelText(/outlier: 2026-02, 8/i);
    expect(outlierMarker).toBeInTheDocument();
  });

  it("does not mark any historical point as an outlier when none are flagged", () => {
    const clean: ForecastResult = {
      ...OK_DATA,
      historical: OK_DATA.historical.map((h) => ({ ...h, isOutlier: false })),
    };
    render(<ForecastChart data={clean} />);

    expect(screen.queryByLabelText(/^outlier:/i)).not.toBeInTheDocument();
  });

  it("renders a message rather than crashing when there is no historical data at all", () => {
    render(<ForecastChart data={{ status: "ok", historical: [], forecast: [] }} />);

    expect(screen.getByText(/no demand history yet/i)).toBeInTheDocument();
  });
});
