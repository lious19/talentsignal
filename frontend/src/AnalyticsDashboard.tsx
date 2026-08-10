import { useEffect, useState } from "react";
import { getStoredRole, getStoredToken } from "./auth";
import { KpiBarChart } from "./KpiBarChart";
import { ForecastChart, type ForecastResult } from "./ForecastChart";
import { AnomalyReviewList, type AnomalyPoint } from "./AnomalyReviewList";

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

// A separate state machine from DashboardState above, deliberately: the
// forecast (S-13) is a second, independent POST call, not part of the
// GET /api/analytics response. Keeping its loading/error states separate
// means a slow or failed forecast never blocks the three KPIs above it from
// rendering — the two sections fail independently.
type ForecastState =
  | { status: "loading" }
  | { status: "ok"; data: ForecastResult }
  | { status: "unauthenticated" }
  | { status: "error" };

type AnomaliesResult =
  | { status: "insufficient-history"; monthsAvailable: number; monthsRequired: number }
  | {
      status: "ok";
      metric: string;
      residualStd: number;
      threshold: { kStdDev: number; updatedAt: string | null };
      points: AnomalyPoint[];
    };

interface SegmentGroup {
  segment: "low" | "medium" | "high";
  clients: { id: string; name: string; openRoles: number }[];
}

interface AnomaliesResponse {
  anomalies: AnomaliesResult;
  segments: { dimension: string; groups: SegmentGroup[] };
}

// S-17's own third state machine, same independent-failure reasoning as
// ForecastState above: a third, independent GET call, so a slow or failed
// anomalies/segmentation fetch never blocks the KPIs or the forecast chart
// that already render above it.
type AnomaliesState =
  | { status: "loading" }
  | { status: "ok"; data: AnomaliesResponse }
  | { status: "unauthenticated" }
  | { status: "error" };

// Reuses ForecastChart.tsx completely unmodified (06_decisions/025) — the
// only new code is this field-mapping: an AnomalyPoint's baseline/isAnomaly
// become a HistoricalPoint's fitted/isOutlier, and there is no forward
// projection here (S-17 has no "next month" forecast), so forecast is
// always empty.
function toForecastChartData(anomalies: AnomaliesResult): ForecastResult {
  if (anomalies.status === "insufficient-history") {
    return {
      status: "insufficient-history",
      monthsAvailable: anomalies.monthsAvailable,
      monthsRequired: anomalies.monthsRequired,
    };
  }
  return {
    status: "ok",
    historical: anomalies.points.map((point) => ({
      month: point.month,
      count: point.count,
      fitted: point.baseline,
      residual: point.residual,
      isOutlier: point.isAnomaly,
    })),
    forecast: [],
  };
}

// The top three numbers, correct, nothing else — no fourth KPI, no date
// picker, no drill-down (Ali: "make the top three numbers correct before
// adding a fourth"). Computed fresh from real data on every load; see
// 06_decisions/020 for why there's no Analytics snapshot table.
export function AnalyticsDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [forecastState, setForecastState] = useState<ForecastState>({ status: "loading" });
  const [anomaliesState, setAnomaliesState] = useState<AnomaliesState>({ status: "loading" });

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

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setForecastState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/predictive-analysis/forecast", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`forecast fetch failed: ${res.status}`);
        return res.json() as Promise<ForecastResult>;
      })
      .then((data) => {
        if (!cancelled) setForecastState({ status: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setForecastState(
          err instanceof Error && err.message === "unauthenticated"
            ? { status: "unauthenticated" }
            : { status: "error" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setAnomaliesState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/analytics/anomalies", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`anomalies fetch failed: ${res.status}`);
        return res.json() as Promise<AnomaliesResponse>;
      })
      .then((data) => {
        if (!cancelled) setAnomaliesState({ status: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setAnomaliesState(
          err instanceof Error && err.message === "unauthenticated"
            ? { status: "unauthenticated" }
            : { status: "error" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Applies a just-decided point's new isAnomaly/decision back into local
  // state without a second round-trip to the server — POST /decide's own
  // response already carries the freshly-reclassified point
  // (revenueAnomalies.ts recomputes it against the post-decision threshold
  // before responding). Immutable update: a new points array with one
  // element replaced, a new anomalies object, a new top-level state object —
  // React only re-renders when it sees a new object reference, not a
  // mutated old one.
  function handleAnomalyDecided(updatedPoint: AnomalyPoint) {
    setAnomaliesState((prev) => {
      if (prev.status !== "ok" || prev.data.anomalies.status !== "ok") return prev;
      return {
        status: "ok",
        data: {
          ...prev.data,
          anomalies: {
            ...prev.data.anomalies,
            points: prev.data.anomalies.points.map((point) =>
              point.month === updatedPoint.month ? updatedPoint : point,
            ),
          },
        },
      };
    });
  }

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

      {/*
        S-13: extends the chart above with a forecast line, a shaded
        confidence band, and marked outliers (06_decisions/021). A separate
        fetch/state machine from the three KPIs above — see ForecastState —
        so a slow or failed forecast never blocks them.
      */}
      <div aria-label="demand forecast">
        <h3>Demand forecast</h3>
        {forecastState.status === "loading" && <p>Loading forecast...</p>}
        {forecastState.status === "unauthenticated" && (
          <p>Your session has expired. Please log in again.</p>
        )}
        {forecastState.status === "error" && <p>Could not load forecast.</p>}
        {forecastState.status === "ok" && <ForecastChart data={forecastState.data} />}
      </div>

      {/*
        S-17: revenue anomaly detection + client segmentation
        (06_decisions/025). Third independent fetch/state machine — see
        AnomaliesState — so this never blocks the KPIs or forecast above it.
        The chart reuses ForecastChart.tsx completely unmodified via
        toForecastChartData()'s field mapping; AnomalyReviewList is the one
        genuinely new piece of UI this story adds. canDecide mirrors the
        backend's DECIDE_ROLES split (admin/sales) — UX only, same as every
        other RoleGate in this app; the real boundary is requireRole on the
        server.
      */}
      <div aria-label="revenue anomalies">
        <h3>Revenue anomalies (placements per month, as a proxy)</h3>
        {anomaliesState.status === "loading" && <p>Loading anomalies...</p>}
        {anomaliesState.status === "unauthenticated" && (
          <p>Your session has expired. Please log in again.</p>
        )}
        {anomaliesState.status === "error" && <p>Could not load anomalies.</p>}
        {anomaliesState.status === "ok" && (
          <>
            <ForecastChart data={toForecastChartData(anomaliesState.data.anomalies)} />
            {anomaliesState.data.anomalies.status === "ok" && (
              <AnomalyReviewList
                points={anomaliesState.data.anomalies.points}
                canDecide={["admin", "sales"].includes(getStoredRole() ?? "")}
                onDecided={handleAnomalyDecided}
              />
            )}
          </>
        )}
      </div>

      <div aria-label="client segments">
        <h3>Clients by hiring volume (advisory only)</h3>
        {anomaliesState.status === "loading" && <p>Loading segments...</p>}
        {anomaliesState.status === "unauthenticated" && (
          <p>Your session has expired. Please log in again.</p>
        )}
        {anomaliesState.status === "error" && <p>Could not load segments.</p>}
        {anomaliesState.status === "ok" &&
          (anomaliesState.data.segments.groups.length === 0 ? (
            <p>No clients to segment yet.</p>
          ) : (
            anomaliesState.data.segments.groups.map((group) => (
              <div key={group.segment}>
                <h4>{group.segment}</h4>
                <ul aria-label={`${group.segment} segment clients`}>
                  {group.clients.map((client) => (
                    <li key={client.id}>
                      {client.name} — {client.openRoles} open role{client.openRoles === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ))}
      </div>
    </section>
  );
}
