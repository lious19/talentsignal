import { useEffect, useState } from "react";
import { getStoredToken } from "../auth";

export interface OpportunitySummary {
  total: number;
  hardToFill: number;
  measuredBasis: number;
  curatedBasis: number;
  noBasis: number;
  sourceExcluded: number;
  totalClients: number;
  totalCandidates: number;
  totalRequisitionsIngested: number;
  generatedAt: string;
}

export type OpportunitySummaryState =
  | { status: "loading" }
  | { status: "ok"; summary: OpportunitySummary }
  | { status: "unauthenticated" }
  | { status: "error" };

// S-24 (Fix 1): the first shared data hook in this codebase. Overview and
// Opportunities both need the same cheap aggregate for their tile counts --
// duplicating this fetch/state machine the way every other screen does its
// own would just recreate the "two screens independently re-fetch and
// re-filter the same data" problem this hook exists to remove.
export function useOpportunitiesSummary(enabled: boolean): OpportunitySummaryState {
  const [state, setState] = useState<OpportunitySummaryState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/opportunities/summary", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`opportunities summary fetch failed: ${res.status}`);
        return res.json() as Promise<OpportunitySummary>;
      })
      .then((summary) => {
        if (!cancelled) setState({ status: "ok", summary });
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
  }, [enabled]);

  return state;
}
