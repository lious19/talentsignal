import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";
import { KpiBarChart } from "./KpiBarChart";

interface AnalyticsResponse {
  placementsPerMonth: { month: string; count: number }[];
  timeToHire: { averageDays: number | null; sampleSize: number };
  demandScore: { average: number | null; sampleSize: number };
}

type DashboardState =
  | { status: "loading" }
  | { status: "ok"; data: AnalyticsResponse }
  | { status: "unauthenticated" }
  | { status: "error" };

// The top three numbers, correct, nothing else — no fourth KPI, no date
// picker, no drill-down (Ali: "make the top three numbers correct before
// adding a fourth"). Computed fresh from real data on every load; see
// 06_decisions/020 for why there's no Analytics snapshot table.
export function AnalyticsDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/analytics", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`analytics fetch failed: ${res.status}`);
        return res.json() as Promise<AnalyticsResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState(
          err instanceof Error && err.message === "unauthenticated"
            ? { status: "unauthenticated" }
            : { status: "error" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p>Loading analytics...</p>;
  if (state.status === "unauthenticated") return <p>Your session has expired. Please log in again.</p>;
  if (state.status === "error") return <p>Could not load analytics.</p>;

  const { placementsPerMonth, timeToHire, demandScore } = state.data;

  return (
    <section aria-label="analytics dashboard">
      <h2>Agency Analytics</h2>

      <div aria-label="placements per month">
        <h3>Placements per month</h3>
        <KpiBarChart data={placementsPerMonth} />
      </div>

      <div aria-label="time to hire">
        <h3>Average time-to-hire</h3>
        <p>
          {timeToHire.averageDays === null ? (
            "No closed placements yet."
          ) : (
            <>
              <strong>{timeToHire.averageDays}</strong> days (from {timeToHire.sampleSize} placement
              {timeToHire.sampleSize === 1 ? "" : "s"})
            </>
          )}
        </p>
      </div>

      <div aria-label="demand score">
        <h3>Demand score</h3>
        <p>
          {demandScore.average === null ? (
            "No opportunities scored yet."
          ) : (
            <>
              <strong>{Math.round(demandScore.average * 100)}%</strong> average confidence (from{" "}
              {demandScore.sampleSize} opportunit{demandScore.sampleSize === 1 ? "y" : "ies"})
            </>
          )}
        </p>
      </div>
    </section>
  );
}
