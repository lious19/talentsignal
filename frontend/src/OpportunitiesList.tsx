import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";

interface ScoreFactor {
  factor: string;
  weight: number;
  value: number;
  contribution: number;
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

  // The API already returns opportunities ranked by confidence descending
  // (S-04), so rank is just this array's position — no separate field to
  // keep in sync with the sort order the backend already applied.
  return (
    <ul aria-label="opportunities">
      {state.opportunities.map((opportunity, index) => (
        <li key={opportunity.id}>
          <span>#{index + 1}</span>{" "}
          <strong>{opportunity.company}</strong>{" "}
          <span>{Math.round(opportunity.confidenceScore * 100)}% confidence</span>
          {" — "}
          <span>{opportunity.reasons.join(", ")}</span>
          {" · "}
          <span>source: {opportunity.source}</span>
          {/* HF-2 trust scenario: never a bare badge. The flag only renders
              WITH its reason attached in the same breath, so a manager sees
              "hard to fill: <why>" as one unit and can trust or dismiss it.
              Only shown when the backend flagged it (score cleared the 026
              threshold); an un-flagged or pre-013 row shows nothing here. */}
          {opportunity.hardToFill && opportunity.hardToFillReasons && opportunity.hardToFillReasons.length > 0 && (
            <>
              {" · "}
              <span aria-label="hard to fill">
                🔴 hard to fill: {opportunity.hardToFillReasons.join(", ")}
              </span>
            </>
          )}
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
                    </li>
                  ))}
                </ul>
              </details>
            )}
        </li>
      ))}
    </ul>
  );
}
