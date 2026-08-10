import { useState } from "react";
import { getStoredToken } from "./auth";

export interface AnomalyPoint {
  month: string;
  count: number;
  baseline: number;
  lowerBound: number;
  upperBound: number;
  residual: number;
  isAnomaly: boolean;
  decision: "unconfirmed" | "confirmed" | "suppressed";
}

interface AnomalyReviewListProps {
  points: AnomalyPoint[];
  canDecide: boolean;
  onDecided: (updatedPoint: AnomalyPoint) => void;
}

// The trust scenario (S-17 🛡, 06_decisions/025): a human reviews each
// flagged, undecided point and either confirms it (record-only — proves it
// was reviewed, changes nothing) or suppresses it (widens that metric's
// threshold band — the ONLY thing that ever changes it). Follows
// PackageReviewScreen.tsx's action-button/actionError convention: one
// pending-action flag, one error slot, optimistic local update on success
// rather than a full refetch.
export function AnomalyReviewList({ points, canDecide, onDecided }: AnomalyReviewListProps) {
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Only points that are BOTH currently anomalous AND not yet reviewed are
  // action items — a suppressed point drops off this list on its own the
  // next time the band widens and reclassifies it as no longer anomalous.
  const undecided = points.filter((point) => point.isAnomaly && point.decision === "unconfirmed");

  async function handleDecide(month: string, decision: "confirmed" | "suppressed") {
    setActionError(null);
    setPendingMonth(month);
    const token = getStoredToken();
    if (!token) {
      setActionError("Your session has expired. Please log in again.");
      setPendingMonth(null);
      return;
    }
    try {
      const res = await fetch("/api/analytics/anomalies/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ month, decision }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to record decision");
        return;
      }
      onDecided({ ...body.point, decision } as AnomalyPoint);
    } catch {
      setActionError("network error — could not reach the server");
    } finally {
      setPendingMonth(null);
    }
  }

  if (undecided.length === 0) {
    return <p>No anomalies awaiting review.</p>;
  }

  return (
    <section aria-label="anomaly review">
      <p role="note">
        Each point below breached its baseline band. Confirm records that a human reviewed
        it. Suppress widens the band for this metric so similar noise fires less often
        going forward — the only way the threshold changes.
      </p>
      {actionError && <p role="alert">{actionError}</p>}
      <ul aria-label="flagged anomalies">
        {undecided.map((point) => (
          <li key={point.month}>
            <strong>{point.month}</strong>: {point.count} (baseline {point.baseline}, expected{" "}
            {point.lowerBound}–{point.upperBound})
            {canDecide ? (
              <>
                {" "}
                <button onClick={() => handleDecide(point.month, "confirmed")} disabled={pendingMonth === point.month}>
                  Confirm
                </button>{" "}
                <button onClick={() => handleDecide(point.month, "suppressed")} disabled={pendingMonth === point.month}>
                  Suppress
                </button>
              </>
            ) : (
              <span> — only admin/sales can confirm or suppress</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
