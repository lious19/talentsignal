import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";

// name/title-only shapes needed for the two pickers.
interface OpportunityOption {
  id: string;
  company: string;
}

interface JobOpeningOption {
  id: string;
  title: string;
}

interface PackageCandidate {
  id: string;
  name: string;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
}

interface PackageContent {
  company: string;
  confidenceScore: number;
  opportunityReasons: string[];
  jobTitle: string;
  candidates: PackageCandidate[];
}

interface OpportunityPackage {
  id: string;
  opportunityId: string;
  jobOpeningId: string;
  content: PackageContent;
  aiGenerated: boolean;
  status: "draft" | "released";
  releasedBy: string | null;
  releasedAt: string | null;
  createdAt: string;
}

type PackagesState =
  | { status: "loading" }
  | { status: "ok"; packages: OpportunityPackage[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// The review-and-release screen: S-09's whole product philosophy in one
// place — AI does the typing (composePackage.ts, server-side), a human owns
// the release. There is no "send" button anywhere on this screen; the
// Release button only ever flips a stored flag, and the composed package
// stays on this platform either way.
export function PackageReviewScreen() {
  const [state, setState] = useState<PackagesState>({ status: "loading" });
  const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
  const [jobOpenings, setJobOpenings] = useState<JobOpeningOption[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [jobOpeningId, setJobOpeningId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/opportunity-packages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error("packages fetch failed");
      const body = (await res.json()) as { packages: OpportunityPackage[] };
      setState({ status: "ok", packages: body.packages });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  useEffect(() => {
    load();
    const token = getStoredToken();
    if (!token) return;

    // Picker options only — a failure here just leaves the picker empty,
    // same "there's nothing else useful to do with this" reasoning
    // MatchScreen.tsx uses for its own job-opening picker.
    fetch("/api/hidden-demand/opportunities?includeSeedData=true", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ opportunities: OpportunityOption[] }>) : null))
      .then((body) => {
        if (body) setOpportunities(body.opportunities);
      })
      .catch(() => {});

    fetch("/api/job-openings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ jobOpenings: JobOpeningOption[] }>) : null))
      .then((body) => {
        if (body) setJobOpenings(body.jobOpenings);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setDrafting(true);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      setDrafting(false);
      return;
    }
    try {
      const res = await fetch("/api/opportunity-package/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ opportunityId, jobOpeningId }),
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to draft package");
        return;
      }
      // Prepend, matching the newest-first order GET already returns.
      setState((prev) =>
        prev.status === "ok"
          ? { ...prev, packages: [body.package as OpportunityPackage, ...prev.packages] }
          : { status: "ok", packages: [body.package as OpportunityPackage] },
      );
    } catch {
      setActionError("network error — could not reach the server");
    } finally {
      setDrafting(false);
    }
  }

  async function handleRelease(packageId: string) {
    setActionError(null);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch(`/api/opportunity-package/${packageId}/release`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      // 200 (released just now) and 409 (already released) both carry the
      // authoritative package in the body — either way, sync local state to
      // it so a stale double-click can never show a button that would lie.
      if (res.status !== 200 && res.status !== 409) {
        setActionError(body.error ?? "failed to release package");
        return;
      }
      const released = body.package as OpportunityPackage;
      setState((prev) =>
        prev.status === "ok"
          ? { ...prev, packages: prev.packages.map((p) => (p.id === released.id ? released : p)) }
          : prev,
      );
      if (res.status === 409) setActionError("this package was already released");
    } catch {
      setActionError("network error — could not reach the server");
    }
  }

  if (state.status === "loading") return <p>Loading opportunity packages...</p>;
  if (state.status === "unauthenticated") {
    return <p>Your session has expired. Please log in again.</p>;
  }
  if (state.status === "error") return <p>Could not load opportunity packages.</p>;

  return (
    <section aria-label="opportunity packages">
      <h2>Opportunity Packages</h2>
      <p role="note">
        Every package below is composed by PackageAgent, not a person — nothing here has been
        sent to anyone. Release is the only action that records a human decision.
      </p>

      <form onSubmit={handleDraft} aria-label="draft a package">
        <label htmlFor="package-opportunity">Opportunity</label>
        <br />
        <select
          id="package-opportunity"
          value={opportunityId}
          onChange={(event) => setOpportunityId(event.target.value)}
          required
        >
          <option value="" disabled>
            Select an opportunity
          </option>
          {opportunities.map((opportunity) => (
            <option key={opportunity.id} value={opportunity.id}>
              {opportunity.company}
            </option>
          ))}
        </select>{" "}
        <label htmlFor="package-job">Job opening</label>
        <br />
        <select
          id="package-job"
          value={jobOpeningId}
          onChange={(event) => setJobOpeningId(event.target.value)}
          required
        >
          <option value="" disabled>
            Select a job opening
          </option>
          {jobOpenings.map((jobOpening) => (
            <option key={jobOpening.id} value={jobOpening.id}>
              {jobOpening.title}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!opportunityId || !jobOpeningId || drafting}>
          {drafting ? "Drafting..." : "Draft package"}
        </button>
      </form>
      {actionError && <p role="alert">{actionError}</p>}

      {state.packages.length === 0 ? (
        <p>No packages drafted yet.</p>
      ) : (
        <ul aria-label="drafted packages">
          {state.packages.map((pkg) => (
            <li key={pkg.id}>
              {/* The prominent, always-visible provenance label the trust
                  scenario requires — not tucked behind a <details>. */}
              <p>
                <strong>{pkg.aiGenerated ? "AI-generated draft" : "Manually authored"}</strong>{" "}
                <span>· status: {pkg.status}</span>
              </p>
              <p>
                <strong>{pkg.content.company}</strong> — {pkg.content.jobTitle}{" "}
                <span>({Math.round(pkg.content.confidenceScore * 100)}% confidence)</span>
              </p>
              <p>{pkg.content.opportunityReasons.join(", ")}</p>
              {pkg.content.candidates.length === 0 ? (
                <p>No matching candidates found.</p>
              ) : (
                <ol aria-label="proposed candidates">
                  {pkg.content.candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <strong>{candidate.name}</strong>{" "}
                      <span>{Math.round(candidate.fitScore * 100)}% fit</span>
                      {" — "}
                      <span>
                        {candidate.matchedSkills.length > 0
                          ? `matched: ${candidate.matchedSkills.join(", ")}`
                          : "no skills matched"}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {pkg.status === "draft" ? (
                <button onClick={() => handleRelease(pkg.id)}>Release</button>
              ) : (
                <p>
                  Released by <strong>{pkg.releasedBy}</strong> at{" "}
                  {pkg.releasedAt ? new Date(pkg.releasedAt).toLocaleString() : "unknown"}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
