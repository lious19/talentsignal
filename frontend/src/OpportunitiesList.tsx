import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";

interface Opportunity {
  id: string;
  company: string;
  confidenceScore: number;
  reasons: string[];
  source: string;
}

type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: Opportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

export function OpportunitiesList() {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/hidden-demand/opportunities", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`opportunities fetch failed: ${res.status}`);
        return res.json() as Promise<{ opportunities: Opportunity[] }>;
      })
      .then((body) => {
        if (!cancelled) setState({ status: "ok", opportunities: body.opportunities });
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

  if (state.status === "loading") return <p>Loading opportunities...</p>;

  if (state.status === "unauthenticated") {
    // Reached only if the stored token was rejected (e.g. expired mid-session) —
    // App.tsx only renders this component at all once a token exists.
    return <p>Your session has expired. Please log in again.</p>;
  }

  if (state.status === "error") return <p>Could not load opportunities.</p>;

  if (state.opportunities.length === 0) return <p>No opportunities yet.</p>;

  return (
    <ul aria-label="opportunities">
      {state.opportunities.map((opportunity) => (
        <li key={opportunity.id}>
          <strong>{opportunity.company}</strong>{" "}
          <span>{Math.round(opportunity.confidenceScore * 100)}% confidence</span>
          {" — "}
          <span>{opportunity.reasons.join(", ")}</span>
          {" · "}
          <span>source: {opportunity.source}</span>
        </li>
      ))}
    </ul>
  );
}
