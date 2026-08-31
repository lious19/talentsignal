import { useEffect, useState } from "react";
import { Building2, Users, Briefcase, Flame, type LucideIcon } from "lucide-react";
import { getStoredToken, getStoredRole } from "./auth";

interface Opportunity {
  id: string;
  hardToFillScore?: number;
}

// Each tile is its own independent fetch/state machine, same convention as
// every other screen in this app (see AnalyticsDashboard.tsx's comment on
// why) -- a slow or failed client count must never block the candidate tile
// from rendering, and vice versa.
type CountState =
  | { status: "loading" }
  | { status: "ok"; count: number }
  | { status: "unauthenticated" }
  | { status: "error" };

// Generic "fetch a list, show its length" tile state -- used directly for
// Clients/Candidates. Opportunities needs two numbers (total + hard-to-fill)
// out of the same response, so it derives both from one fetch below instead
// of calling this twice.
function useListCount(path: string, listKey: string, enabled: boolean): CountState {
  const [state, setState] = useState<CountState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`${path} fetch failed: ${res.status}`);
        return res.json();
      })
      .then((body: Record<string, unknown[]>) => {
        if (!cancelled) setState({ status: "ok", count: (body[listKey] ?? []).length });
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
  }, [path, listKey, enabled]);

  return state;
}

function tileValue(state: CountState): string {
  return state.status === "ok" ? String(state.count) : state.status === "loading" ? "…" : "—";
}

function StatTile({ label, state, icon: Icon }: { label: string; state: CountState; icon: LucideIcon }) {
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <div className="stat-tile-icon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <div className="stat-tile-body">
        <span className="stat-tile-value">{tileValue(state)}</span>
        <span className="stat-tile-label">{label}</span>
      </div>
      {state.status === "error" && <span className="stat-tile-error">Could not load</span>}
    </div>
  );
}

// Overview: the default landing screen after login (Angel's ask). Four
// tiles, each reading a count from an endpoint that already exists and is
// already used elsewhere in the app -- no new backend route, no new business
// logic. Opportunities/hard-to-fill are gated to admin/sales because
// GET /api/hidden-demand/opportunities itself is admin/sales-only on the
// backend (same as the real Opportunities screen's RoleGate) -- a recruiter
// would otherwise get a 403 on a tile they were never meant to see.
export function OverviewScreen() {
  const role = getStoredRole();
  const canSeeOpportunities = role === "admin" || role === "sales";

  const clients = useListCount("/api/clients", "clients", true);
  const candidates = useListCount("/api/candidates", "candidates", true);

  const [opportunitiesState, setOpportunitiesState] = useState<CountState>({ status: "loading" });
  const [hardToFillState, setHardToFillState] = useState<CountState>({ status: "loading" });

  useEffect(() => {
    if (!canSeeOpportunities) return;
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setOpportunitiesState({ status: "unauthenticated" });
      setHardToFillState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/hidden-demand/opportunities?includeSeedData=true", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`opportunities fetch failed: ${res.status}`);
        return res.json() as Promise<{ opportunities: Opportunity[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setOpportunitiesState({ status: "ok", count: body.opportunities.length });
        setHardToFillState({
          status: "ok",
          count: body.opportunities.filter((o) => (o.hardToFillScore ?? 0) > 0).length,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const status =
          err instanceof Error && err.message === "unauthenticated" ? "unauthenticated" : "error";
        setOpportunitiesState({ status });
        setHardToFillState({ status });
      });

    return () => {
      cancelled = true;
    };
  }, [canSeeOpportunities]);

  return (
    <section aria-label="overview">
      <h2>Overview</h2>
      <div className="stat-grid">
        <StatTile label="Total Clients" state={clients} icon={Building2} />
        <StatTile label="Total Candidates" state={candidates} icon={Users} />
        {canSeeOpportunities && (
          <>
            <StatTile label="Total Opportunities" state={opportunitiesState} icon={Briefcase} />
            <StatTile label="Hard-to-Fill Count" state={hardToFillState} icon={Flame} />
          </>
        )}
      </div>
    </section>
  );
}
