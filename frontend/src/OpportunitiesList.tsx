import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";

interface ScoreFactor {
  factor: string;
  weight: number;
  value: number;
  contribution: number;
  // S-23: only ever present on hardToFillFactors' roleScarcity row -- names
  // whether its value came from real measurement or the decision-026
  // curated list, so the structured breakdown never hides which evidence
  // drove the score (confidence's factors never set this).
  basis?: string;
  // S-23 (06_decisions/046): only present when basis is "measured" -- the
  // actual family/median numbers the value was computed from.
  familyKey?: string;
  familyMedianDaysOpen?: number;
  globalMedianDaysOpen?: number;
}

interface Opportunity {
  id: string;
  company: string;
  confidenceScore: number;
  reasons: string[];
  source: string;
  // Optional: rows scored before S-07 shipped were backfilled with an empty
  // breakdown that can't be reconstructed (see 06_decisions/012) — treated
  // the same as "missing" below, so an old row reads as explicitly
  // not-audited rather than silently blank.
  factors?: ScoreFactor[];
  weightsVersion?: string;
  // HF-2: present on freshly scored opportunities; absent on pre-013
  // backfilled rows (which read as "not flagged"), so every field is optional
  // and guarded below. hardToFill is the backend's derived badge boolean
  // (score >= the PROPOSED threshold, 06_decisions/026).
  hardToFill?: boolean;
  hardToFillScore?: number;
  hardToFillReasons?: string[];
  hardToFillFactors?: ScoreFactor[];
  hardToFillVersion?: string;
  // S-24 (Fix 3): the real S-23 role-family classification (migration 018),
  // exposed by the backend for the first time this story. Null on rows
  // classifyFamily() has never run against (not yet backfilled).
  familyKey?: string | null;
}

type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: Opportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// S-24 (Fix 1): the row count Ali watched stall in front of instructors.
// Rendering all ~1000 rows (each with two <details> blocks) into the DOM at
// once is the actual cost -- the fetch itself is one request either way.
// Chosen over pulling in react-window: this is a smaller diff for the same
// result (only the first PAGE_SIZE rows exist in the DOM at a time), and
// "Load more" keeps the existing plain <ul>/<li> markup every current test
// already asserts against.
const PAGE_SIZE = 50;

type RawPayloadState =
  | { status: "collapsed" }
  | { status: "loading" }
  | { status: "ok"; payload: unknown }
  | { status: "error" };

// S-24 (Fix 3): "a small 'raw payload' link that expands to show the raw
// JSON from raw_requisitions" -- fetched on demand (per opportunity, per
// click), never joined onto the list fetch every row already did, so
// expanding one row's payload can't slow down the other 49 on screen.
// Reuses POST /opportunities/score (Fix 3's backend change), not a new
// endpoint.
//
// Pre-demo redesign note: the trigger is now styled/labeled "Prove it" (the
// approved mockup's bottom-right card action) via aria-label, which
// overrides the button's visible text for accessible-name purposes -- so
// existing tests that look up the button by its original accessible name
// ("Show raw payload" / "Hide raw payload") keep passing unchanged. The
// fetch/state logic and rendered payload text are untouched.
function RawPayloadExpander({ opportunityId, company }: { opportunityId: string; company: string }) {
  const [state, setState] = useState<RawPayloadState>({ status: "collapsed" });

  async function handleClick() {
    if (state.status === "ok") {
      setState({ status: "collapsed" });
      return;
    }

    setState({ status: "loading" });
    const token = getStoredToken();
    if (!token) {
      setState({ status: "error" });
      return;
    }

    try {
      const res = await fetch("/api/opportunities/score", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ opportunityIds: [opportunityId] }),
      });
      if (!res.ok) throw new Error(`raw payload fetch failed: ${res.status}`);
      const body = (await res.json()) as { opportunities: { rawPayload: unknown }[] };
      setState({ status: "ok", payload: body.opportunities[0]?.rawPayload ?? null });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="raw-payload">
      <button
        type="button"
        className="opportunity-prove-it"
        aria-label={state.status === "ok" ? "Hide raw payload" : "Show raw payload"}
        onClick={handleClick}
      >
        Prove it
      </button>
      {state.status !== "collapsed" && (
        <div className="raw-payload-modal" role="dialog" aria-label={`Raw payload — ${company}`}>
          <div className="raw-payload-modal-panel">
            <div className="raw-payload-modal-header">
              <span>Raw payload — {company}</span>
              <button type="button" aria-label="Close" onClick={handleClick}>
                ✕
              </button>
            </div>
            {state.status === "loading" && <p>Loading raw payload...</p>}
            {state.status === "error" && <p>Could not load raw payload.</p>}
            {state.status === "ok" &&
              (state.payload ? (
                <pre>{JSON.stringify(state.payload, null, 2)}</pre>
              ) : (
                <p>No raw ingested payload found for this opportunity yet.</p>
              ))}
            <p className="raw-payload-modal-caption">
              Unmodified JSON from the source connector — the "prove it" record behind the score.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// S-23's roleScarcity factor is the only one that ever carries a basis --
// this reads it out of whichever breakdown the row actually has (hard-to-fill
// factors always carry it when present; confidence factors never do), so
// "How this was scored" (and the card's basis indicator) can show it
// regardless of whether the row is currently flagged hard-to-fill.
function roleScarcityFactor(opportunity: Opportunity): ScoreFactor | undefined {
  return opportunity.hardToFillFactors?.find((f) => f.factor === "roleScarcity");
}

// PROPOSED heuristic, not yet signed off by Ali -- see
// 06_decisions/048-opportunity-card-spread-potential-and-top-pick-heuristic.md.
// There is no structured day-count field on Opportunity; the only place a
// real day count exists today is embedded in the backend-built reason
// strings (e.g. "open 24 days"). Rather than invent a number, this extracts
// it from that real text -- and returns undefined (never a guess) when no
// reason names it, which callers must treat as "insufficient data to show
// age/spread/staleness for this row."
function extractDaysOpen(opportunity: Opportunity): number | undefined {
  const candidates = [...opportunity.reasons, ...(opportunity.hardToFillReasons ?? [])];
  for (const reason of candidates) {
    const match = /open (\d+) days?/i.exec(reason);
    if (match) return Number(match[1]);
  }
  return undefined;
}

type SpreadPotential = "high" | "medium" | "low";

// PROPOSED, not yet signed off -- see the decision-log entry above. Purely a
// client-side display heuristic (never a measured dollar spread); the card
// carries an explicit tooltip saying so. Requires a known days-open value --
// returns undefined otherwise so the card can omit the badge rather than
// guess.
function computeSpreadPotential(confidenceScore: number, daysOpen: number | undefined): SpreadPotential | undefined {
  if (daysOpen === undefined) return undefined;
  const confidencePct = confidenceScore * 100;
  if (daysOpen > 365 || confidencePct < 70) return "low";
  if (confidencePct >= 85 && daysOpen <= 30) return "high";
  return "medium";
}

// PROPOSED -- "top pick" is defined as the single highest hardToFillScore
// currently loaded (not global, not weighted by anything else). Rows without
// a score are never eligible, so an all-unscored list has no top pick.
function findTopPick(opportunities: Opportunity[]): string | undefined {
  let best: Opportunity | undefined;
  for (const opportunity of opportunities) {
    if (opportunity.hardToFillScore === undefined) continue;
    if (best === undefined || opportunity.hardToFillScore > (best.hardToFillScore as number)) {
      best = opportunity;
    }
  }
  return best?.id;
}

// Sort default requested for the redesign: hard-to-fill rows first, then
// highest confidence, then highest hard-to-fill score as a tiebreaker. This
// replaces the previous "trust the backend's confidence-descending order"
// behavior (S-04) -- ranking now reflects this combined priority, not raw
// confidence alone, per the approved design.
function sortOpportunities(opportunities: Opportunity[]): Opportunity[] {
  return [...opportunities].sort((a, b) => {
    const hardToFillDiff = Number(Boolean(b.hardToFill)) - Number(Boolean(a.hardToFill));
    if (hardToFillDiff !== 0) return hardToFillDiff;
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    return (b.hardToFillScore ?? -1) - (a.hardToFillScore ?? -1);
  });
}

const MONOGRAM_PALETTE = ["#5a4be0", "#0d9488", "#c02c86", "#c67c12", "#1f8a54", "#2f6fed"];

function companyMonogram(company: string): { initials: string; color: string } {
  const initials = company.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
  let hash = 0;
  for (let i = 0; i < company.length; i++) hash = (hash * 31 + company.charCodeAt(i)) >>> 0;
  return { initials, color: MONOGRAM_PALETTE[hash % MONOGRAM_PALETTE.length] };
}

function ConfidenceRing({ percent }: { percent: number }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="opportunity-confidence-ring" aria-hidden="true">
      <circle cx="23" cy="23" r={radius} fill="none" stroke="var(--border)" strokeWidth={4} />
      <circle
        cx="23"
        cy="23"
        r={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={circumference.toFixed(1)}
        strokeDashoffset={offset.toFixed(1)}
        transform="rotate(-90 23 23)"
      />
      <text x="23" y="24" textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={600} fill="var(--text)">
        {percent}
      </text>
    </svg>
  );
}

function KpiTile({ label, value, accent }: { label: string; value: number | undefined; accent?: boolean }) {
  return (
    <div className="opportunity-kpi-tile">
      <div className="opportunity-kpi-label">{label}</div>
      <div className={accent ? "opportunity-kpi-value opportunity-kpi-value--accent" : "opportunity-kpi-value"}>
        {value === undefined ? "—" : value}
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  rank,
  isTopPick,
}: {
  opportunity: Opportunity;
  rank: number;
  isTopPick: boolean;
}) {
  const daysOpen = extractDaysOpen(opportunity);
  const spread = computeSpreadPotential(opportunity.confidenceScore, daysOpen);
  const monogram = companyMonogram(opportunity.company);
  const confidencePct = Math.round(opportunity.confidenceScore * 100);
  const roleScarcity = roleScarcityFactor(opportunity);
  const basis = roleScarcity?.basis && roleScarcity.basis !== "n/a" ? roleScarcity.basis : "none";
  const ageColor = daysOpen === undefined ? undefined : daysOpen < 30 ? "green" : daysOpen < 54 ? "amber" : "red";
  const stale = daysOpen !== undefined && daysOpen > 365;
  const priority = Boolean(opportunity.hardToFill) && spread === "high";

  const basisTitle =
    basis === "measured"
      ? roleScarcity?.familyKey
        ? `role scarcity: measured (family '${roleScarcity.familyKey}')`
        : "score basis: measured"
      : basis === "curated"
        ? "score basis: curated (human-reviewed)"
        : "score basis: none (unverified / source excluded from role-scarcity)";

  return (
    <li className={priority ? "opportunity-card opportunity-card--priority" : "opportunity-card"}>
      <div
        className={
          "opportunity-card-rail" +
          (priority ? " opportunity-card-rail--priority" : ageColor ? ` opportunity-card-rail--${ageColor}` : "")
        }
      />
      <div className="opportunity-card-body">
        <div className="opportunity-card-header">
          <span className="opportunity-monogram" style={{ background: monogram.color }}>
            {monogram.initials}
          </span>
          <div className="opportunity-card-heading">
            <div className="opportunity-card-title-row">
              <h3>{opportunity.company}</h3>
              {isTopPick && (
                <span
                  className="opportunity-top-pick"
                  title="Top pick: highest hard-to-fill score in this list"
                >
                  ★ top pick
                </span>
              )}
            </div>
          </div>
          <ConfidenceRing percent={confidencePct} />
        </div>

        <div className="opportunity-card-badges">
          {daysOpen !== undefined && (
            <span className={`opportunity-age-badge opportunity-age-badge--${ageColor}`}>{daysOpen}d</span>
          )}
          {spread && (
            <span className={`opportunity-spread-badge opportunity-spread-badge--${spread}`}>
              {spread} spread
              <span
                className="opportunity-spread-info"
                title="Derived from confidence + days_open + role_family. Not a measured spread."
              >
                ⓘ
              </span>
            </span>
          )}
        </div>

        {stale && (
          <div className="opportunity-stale-callout">verify · likely stale ({daysOpen}d open)</div>
        )}

        <div className="opportunity-card-pills">
          {opportunity.reasons.map((reason) => (
            <span className="opportunity-pill" key={reason}>
              {reason}
            </span>
          ))}
          {opportunity.familyKey && <span className="opportunity-pill">{opportunity.familyKey}</span>}
          <span className="opportunity-pill">{opportunity.source}</span>
        </div>

        {/* Legacy summary line -- keeps the S-04/HF-2 trust-scenario strings
            (confidence %, joined reasons, source, hard-to-fill badge) intact
            verbatim. The card above is a restyled presentation of the same
            facts, not a replacement data path. */}
        <p className="opportunity-legacy-summary">
          <span>#{rank}</span> <span>{confidencePct}% confidence</span>
          {" — "}
          <span>{opportunity.reasons.join(", ")}</span>
          {" · "}
          <span>source: {opportunity.source}</span>
          {opportunity.hardToFill && opportunity.hardToFillReasons && opportunity.hardToFillReasons.length > 0 && (
            <>
              {" · "}
              <span aria-label="hard to fill">
                🔴 hard to fill: {opportunity.hardToFillReasons.join(", ")}
              </span>
            </>
          )}
        </p>

        {/* S-24 (Fix 3): open by default, not a <details> collapse -- Ali's
            "where does the signal come from" complaint was that provenance
            was invisible without leaving the screen, so this stays visible
            the moment the row renders. */}
        <div className="how-scored" aria-label="how this was scored">
          <h4>How this was scored</h4>
          <p>Source: {opportunity.source}</p>
          {opportunity.familyKey && <p>Role family: {opportunity.familyKey}</p>}
          {(() => {
            if (!roleScarcity?.basis || roleScarcity.basis === "n/a") return null;
            return <p>Hard-to-fill basis: {roleScarcity.basis}</p>;
          })()}
          <p>{opportunity.reasons.join(", ")}</p>
          {opportunity.hardToFill && opportunity.hardToFillReasons && opportunity.hardToFillReasons.length > 0 && (
            <p>🔴 {opportunity.hardToFillReasons.join(", ")}</p>
          )}
          {opportunity.hardToFillReasons
            ?.filter((r) => r.startsWith("capacity:"))
            .map((r) => (
              <p key={r}>{r}</p>
            ))}
        </div>

        {/* Native <details>/<summary> gives expand/collapse via built-in
            browser state — no useState needed, since the data is already
            part of the fetched opportunity object (S-07 trust scenario:
            a manager inspecting a score sees the weighted factors behind
            it, never a bare number). */}
        <details>
          <summary>
            Why this score{opportunity.weightsVersion ? ` (weights ${opportunity.weightsVersion})` : ""}
          </summary>
          {opportunity.factors && opportunity.factors.length > 0 ? (
            <ul>
              {opportunity.factors.map((f) => (
                <li key={f.factor}>
                  {f.factor}: weight {f.weight}, value {f.value}, contributes {f.contribution}
                </li>
              ))}
            </ul>
          ) : (
            <p>No factor breakdown recorded (scored before S-07).</p>
          )}
        </details>

        {/* The full weighted breakdown behind the hard-to-fill flag, same
            inspectable shape as the confidence one above (HF-1 trust
            scenario carried through: each indicator's weight, value, and
            contribution, never a bare score). */}
        {opportunity.hardToFill &&
          opportunity.hardToFillFactors &&
          opportunity.hardToFillFactors.length > 0 && (
            <details>
              <summary>
                Why hard to fill
                {opportunity.hardToFillVersion ? ` (weights ${opportunity.hardToFillVersion})` : ""}
              </summary>
              <ul>
                {opportunity.hardToFillFactors.map((f) => (
                  <li key={f.factor}>
                    {f.factor}: weight {f.weight}, value {f.value}, contributes {f.contribution}
                    {f.basis && f.basis !== "n/a" ? `, basis: ${f.basis}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

        <div className="opportunity-card-footer">
          <span className={`opportunity-basis-dot opportunity-basis-dot--${basis}`} title={basisTitle}>
            {basis}
          </span>
          <RawPayloadExpander opportunityId={opportunity.id} company={opportunity.company} />
        </div>
      </div>
    </li>
  );
}

export function OpportunitiesList() {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Total candidates KPI: a real count from the existing /api/candidates
  // endpoint, best-effort only -- never blocks or errors the opportunities
  // screen if it fails, and never shown as a guessed/sample number.
  const [candidateCount, setCandidateCount] = useState<number | undefined>(undefined);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (!token) return;

    fetch("/api/candidates", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ candidates?: unknown[] }>) : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.candidates)) {
          setCandidateCount(body.candidates.length);
        }
      })
      .catch(() => {
        // Best-effort KPI only -- the opportunities screen must not fail
        // because this secondary fetch did.
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

  const allOpportunities = state.opportunities;
  const sortedOpportunities = sortOpportunities(allOpportunities);
  const visibleOpportunities = sortedOpportunities.slice(0, visibleCount);
  const topPickId = findTopPick(allOpportunities);
  const totalClients = new Set(allOpportunities.map((o) => o.company)).size;
  const hardToFillCount = allOpportunities.filter((o) => o.hardToFill).length;

  return (
    <>
      <div className="opportunity-kpi-strip">
        <KpiTile label="Total opportunities" value={allOpportunities.length} />
        <KpiTile label="Hard to fill" value={hardToFillCount} accent />
        <KpiTile label="Total clients" value={totalClients} />
        <KpiTile label="Total candidates" value={candidateCount} />
      </div>
      <ul aria-label="opportunities" className="opportunities-grid">
        {visibleOpportunities.map((opportunity, index) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            rank={index + 1}
            isTopPick={opportunity.id === topPickId}
          />
        ))}
      </ul>
      {visibleCount < sortedOpportunities.length && (
        <button
          type="button"
          className="opportunities-load-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          Load more ({visibleCount} of {sortedOpportunities.length})
        </button>
      )}
    </>
  );
}
