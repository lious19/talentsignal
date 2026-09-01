import { useEffect, useState } from "react";
import { Building2, Users, Briefcase, Flame, Play, Clock, type LucideIcon } from "lucide-react";
import { getStoredToken, getStoredRole, getStoredEmail } from "./auth";

interface Opportunity {
  id: string;
  source: string;
  confidenceScore: number;
  hardToFillScore?: number;
  diffComputedAt: string | null;
}

// Each simple tile is its own independent fetch/state machine, same
// convention as every other screen in this app (see AnalyticsDashboard.tsx's
// comment on why) -- a slow or failed client count must never block the
// candidate tile from rendering, and vice versa.
type CountState =
  | { status: "loading" }
  | { status: "ok"; count: number }
  | { status: "unauthenticated" }
  | { status: "error" };

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

// The opportunities fetch backs four different pieces of this screen (the
// two opportunity tiles, the latest-ingestion card, the distribution donut)
// -- one shared array-based state instead of useListCount, so it's fetched
// once and every consumer derives from the same rows.
type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: Opportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

function useOpportunities(enabled: boolean): OpportunitiesState {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
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
  }, [enabled]);

  return state;
}

function tileValue(state: CountState): string {
  return state.status === "ok" ? String(state.count) : state.status === "loading" ? "…" : "—";
}

function StatTile({
  label,
  state,
  icon: Icon,
  accentVar,
  realBadge,
  progress,
}: {
  label: string;
  state: CountState;
  icon: LucideIcon;
  accentVar: "--accent" | "--accent-2";
  realBadge: string;
  // Optional, and only ever passed when both numbers come from data already
  // fetched on this screen -- no tile fabricates a denominator it doesn't
  // have (e.g. Clients/Candidates/Opportunities have no natural "out of
  // what" and stay bar-less).
  progress?: { current: number; total: number };
}) {
  const showProgress = state.status === "ok" && progress && progress.total > 0;
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <div className="stat-tile-icon" style={{ background: `var(${accentVar})` }}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <span className="stat-tile-value">{tileValue(state)}</span>
      <span className="stat-tile-label">{label}</span>
      {state.status === "ok" && <span className="stat-tile-real-badge">{realBadge}</span>}
      {state.status === "error" && <span className="stat-tile-error">Could not load</span>}
      {showProgress && (
        <div className="stat-tile-progress">
          <div className="stat-tile-progress-track">
            <div
              className="stat-tile-progress-fill"
              style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
            />
          </div>
          <span className="stat-tile-progress-label">
            {progress.current} of {progress.total} opportunities
          </span>
        </div>
      )}
    </div>
  );
}

// Local-part heuristic only, never a security- or identity-bearing
// decision -- purely a friendlier greeting. Falls back to a generic
// greeting for anything that doesn't cleanly read as a name (role-style
// addresses, all-numeric local parts, no stored email at all).
function firstNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._+-]+/).find((part) => part.length > 0);
  if (!first || !/^[a-zA-Z]+$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface Tier {
  label: string;
  count: number;
  colorVar: string;
}

const RADIUS = 60;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Pure SVG donut -- no chart library. Stacks one <circle> per segment, each
// using stroke-dasharray/-dashoffset to draw only its own arc of the ring;
// the enclosing <g> is rotated -90deg so segments start at 12 o'clock.
function DonutChart({ tiers }: { tiers: Tier[] }) {
  const total = tiers.reduce((sum, tier) => sum + tier.count, 0);
  let cumulative = 0;

  return (
    <svg viewBox="0 0 160 160" className="donut-svg" role="img" aria-label="Opportunity distribution by confidence tier">
      <g transform="rotate(-90 80 80)">
        {total === 0 ? (
          <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
        ) : (
          tiers
            .filter((tier) => tier.count > 0)
            .map((tier) => {
              const dash = (tier.count / total) * CIRCUMFERENCE;
              const offset = -cumulative;
              cumulative += dash;
              return (
                <circle
                  key={tier.label}
                  cx="80"
                  cy="80"
                  r={RADIUS}
                  fill="none"
                  stroke={`var(${tier.colorVar})`}
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  strokeDashoffset={offset}
                />
              );
            })
        )}
      </g>
      <text x="80" y="76" textAnchor="middle" className="donut-total-value">
        {total}
      </text>
      <text x="80" y="94" textAnchor="middle" className="donut-total-label">
        total
      </text>
    </svg>
  );
}

// Overview: the default landing screen after login. Opportunities/
// hard-to-fill/distribution/latest-ingestion are all gated to admin/sales
// because GET /api/hidden-demand/opportunities itself is admin/sales-only
// on the backend (same as the real Opportunities screen's RoleGate) -- a
// recruiter would otherwise get a 403 on data they were never meant to see.
export function OverviewScreen() {
  const role = getStoredRole();
  const canSeeOpportunities = role === "admin" || role === "sales";
  const email = getStoredEmail();
  const firstName = firstNameFromEmail(email);

  const clients = useListCount("/api/clients", "clients", true);
  const candidates = useListCount("/api/candidates", "candidates", true);
  const opportunitiesState = useOpportunities(canSeeOpportunities);

  const opportunities = opportunitiesState.status === "ok" ? opportunitiesState.opportunities : [];
  const opportunitiesCount: CountState =
    opportunitiesState.status === "ok"
      ? { status: "ok", count: opportunities.length }
      : opportunitiesState.status === "loading" || opportunitiesState.status === "unauthenticated"
        ? opportunitiesState
        : { status: "error" };
  const hardToFillCount: CountState =
    opportunitiesState.status === "ok"
      ? { status: "ok", count: opportunities.filter((o) => (o.hardToFillScore ?? 0) > 0).length }
      : opportunitiesState.status === "loading" || opportunitiesState.status === "unauthenticated"
        ? opportunitiesState
        : { status: "error" };

  const tiers: Tier[] = [
    { label: "Strong", count: opportunities.filter((o) => o.confidenceScore >= 0.7).length, colorVar: "--success" },
    {
      label: "Good",
      count: opportunities.filter((o) => o.confidenceScore >= 0.5 && o.confidenceScore < 0.7).length,
      colorVar: "--accent",
    },
    {
      label: "Review",
      count: opportunities.filter((o) => o.confidenceScore >= 0.25 && o.confidenceScore < 0.5).length,
      colorVar: "--warning",
    },
    { label: "Poor", count: opportunities.filter((o) => o.confidenceScore < 0.25).length, colorVar: "--danger" },
  ];
  const tiersTotal = tiers.reduce((sum, t) => sum + t.count, 0);

  const sources = [...new Set(opportunities.map((o) => o.source))].sort();
  const latestDiff = opportunities
    .map((o) => o.diffComputedAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  return (
    <section aria-label="overview">
      <div className="overview-header">
        <div>
          <h2 className="overview-greeting">{firstName ? `Good morning, ${firstName}` : "Welcome back"}</h2>
          {/* GREENHOUSE_BOARDS/LEVER_COMPANIES are backend-only env vars with
              no endpoint exposing them to the frontend, and this pass adds
              no new backend route -- using the non-config-exposing fallback
              the ticket offered for exactly this case. */}
          <p className="overview-subtitle">Your talent signal intelligence</p>
        </div>
        <button type="button" disabled title="Coming soon" className="overview-run-ingestion">
          <Play size={15} aria-hidden="true" />
          Run Ingestion
        </button>
      </div>

      <div className="stat-grid">
        <StatTile label="Total Clients" state={clients} icon={Building2} accentVar="--accent" realBadge="in database" />
        <StatTile
          label="Total Candidates"
          state={candidates}
          icon={Users}
          accentVar="--accent-2"
          realBadge="in database"
        />
        {canSeeOpportunities && (
          <>
            <StatTile
              label="Total Opportunities"
              state={opportunitiesCount}
              icon={Briefcase}
              accentVar="--accent"
              realBadge="active"
            />
            <StatTile
              label="Hard-to-Fill Count"
              state={hardToFillCount}
              icon={Flame}
              accentVar="--accent-2"
              realBadge="flagged"
              progress={
                hardToFillCount.status === "ok" && opportunitiesCount.status === "ok"
                  ? { current: hardToFillCount.count, total: opportunitiesCount.count }
                  : undefined
              }
            />
          </>
        )}
      </div>

      {canSeeOpportunities && (
        <div className="overview-bottom">
          <div className="overview-card overview-card-ingestion">
            <h3>Latest Ingestion</h3>
            {opportunitiesState.status === "loading" && <p>Loading...</p>}
            {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
            {opportunitiesState.status === "error" && <p>Could not load ingestion activity.</p>}
            {opportunitiesState.status === "ok" && (
              <>
                <p className="overview-card-subhead">
                  <Clock size={14} aria-hidden="true" />
                  Last run: {latestDiff ? formatRelativeTime(latestDiff) : "never"}
                </p>
                <p>
                  <strong>{opportunities.length}</strong> opportunit{opportunities.length === 1 ? "y" : "ies"}{" "}
                  ingested from {sources.length > 0 ? sources.join(", ") : "no sources yet"}
                </p>
              </>
            )}
          </div>

          <div className="overview-card overview-card-distribution">
            <h3>Opportunity Distribution</h3>
            {opportunitiesState.status === "loading" && <p>Loading...</p>}
            {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
            {opportunitiesState.status === "error" && <p>Could not load distribution.</p>}
            {opportunitiesState.status === "ok" && (
              <div className="donut-layout">
                <DonutChart tiers={tiers} />
                <ul className="donut-legend" aria-label="confidence tier legend">
                  {tiers.map((tier) => (
                    <li key={tier.label}>
                      <span className="donut-legend-swatch" style={{ background: `var(${tier.colorVar})` }} />
                      <span className="donut-legend-label">{tier.label}</span>
                      <span className="donut-legend-count">
                        {tier.count} ({tiersTotal > 0 ? Math.round((tier.count / tiersTotal) * 100) : 0}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
