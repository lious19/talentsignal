import { useEffect, useState } from "react";
import { OpportunitiesList } from "./OpportunitiesList";
import { LoginScreen } from "./LoginScreen";
import { RegisterScreen } from "./RegisterScreen";
import { ClientsScreen } from "./ClientsScreen";
import { CandidatesScreen } from "./CandidatesScreen";
import { JobOpeningsScreen } from "./JobOpeningsScreen";
import { MatchScreen } from "./MatchScreen";
import { SalesPipelineBoard } from "./SalesPipelineBoard";
import { PackageReviewScreen } from "./PackageReviewScreen";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { RecommendationScreen } from "./RecommendationScreen";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { PrivacyRequestScreen } from "./PrivacyRequestScreen";
import { RoleGate } from "./RoleGate";
import { clearStoredToken, getStoredToken } from "./auth";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; db: string }
  | { status: "error" };

type AuthView = "login" | "register";

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  // Lazy initializer (the () => ... form) runs getStoredToken() once, on
  // the first render only — not on every re-render the way `useState(getStoredToken())`
  // would call it.
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [authView, setAuthView] = useState<AuthView>("login");
  // Which screen the top nav is currently showing. Every screen stays mounted
  // (so it keeps fetching and so the role-gating tests still see it); only the
  // active one is visible — the others carry the `hidden` attribute.
  const [view, setView] = useState<string>("opportunities");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`health check failed: ${res.status}`);
        return res.json() as Promise<{ status: string; db: string }>;
      })
      .then((body) => {
        if (!cancelled) setHealth({ status: "ok", db: body.db });
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    setAuthView("login");
  }

  // A small helper so each nav button is written the same way. `key` matches the
  // `view` value that reveals its screen below.
  function navBtn(key: string, label: string) {
    return (
      <button
        type="button"
        className={view === key ? "navbtn on" : "navbtn"}
        onClick={() => setView(key)}
      >
        {label}
      </button>
    );
  }

  return (
    <main>
      <header className="appbar">
        <h1>TalentSignal</h1>
        <section aria-label="backend health">
          {health.status === "loading" && <p>Checking backend...</p>}
          {health.status === "ok" && <p>Backend reachable — db: {health.db}</p>}
          {health.status === "error" && <p>Backend unreachable</p>}
        </section>
        {token && (
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        )}
      </header>

      {token ? (
        <>
          {/* Top navigation — each item is role-gated the same way its screen is,
              so a role only ever sees tabs it is allowed to open. */}
          <nav className="topnav" aria-label="sections">
            <RoleGate allow={["admin", "sales"]}>{navBtn("opportunities", "Opportunities")}</RoleGate>
            <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("clients", "Clients")}</RoleGate>
            <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("candidates", "Candidates")}</RoleGate>
            <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("jobs", "Jobs")}</RoleGate>
            <RoleGate allow={["admin", "sales"]}>{navBtn("match", "Match")}</RoleGate>
            <RoleGate allow={["admin", "sales"]}>{navBtn("pipeline", "Pipeline")}</RoleGate>
            <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("packages", "Packages")}</RoleGate>
            <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("relationships", "Relationships")}</RoleGate>
            <RoleGate allow={["admin", "recruiter"]}>{navBtn("recommendations", "Recommendations")}</RoleGate>
            <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("analytics", "Analytics")}</RoleGate>
            <RoleGate allow={["admin", "recruiter"]}>{navBtn("privacy", "Privacy")}</RoleGate>
          </nav>

          {/* Role gates per 06_decisions/022's permission matrix — UX only,
              the backend requireRole gate is the real boundary. */}
          <div hidden={view !== "opportunities"}>
            <RoleGate allow={["admin", "sales"]}>
              <section aria-label="opportunities">
                <h2>Opportunities</h2>
                <OpportunitiesList />
              </section>
            </RoleGate>
          </div>
          <div hidden={view !== "clients"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <ClientsScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "candidates"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <CandidatesScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "jobs"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <JobOpeningsScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "match"}>
            <RoleGate allow={["admin", "sales"]}>
              <MatchScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "pipeline"}>
            <RoleGate allow={["admin", "sales"]}>
              <SalesPipelineBoard />
            </RoleGate>
          </div>
          <div hidden={view !== "packages"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <PackageReviewScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "relationships"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <RelationshipsPanel />
            </RoleGate>
          </div>
          <div hidden={view !== "recommendations"}>
            <RoleGate allow={["admin", "recruiter"]}>
              <RecommendationScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "analytics"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <AnalyticsDashboard />
            </RoleGate>
          </div>
          {/* Staff-initiated privacy workflow, not a candidate-facing
              portal — there is no candidate login anywhere in this app
              (06_decisions/023). */}
          <div hidden={view !== "privacy"}>
            <RoleGate allow={["admin", "recruiter"]}>
              <PrivacyRequestScreen />
            </RoleGate>
          </div>
        </>
      ) : authView === "login" ? (
        <LoginScreen onSuccess={setToken} onSwitchToRegister={() => setAuthView("register")} />
      ) : (
        <RegisterScreen onSuccess={setToken} onSwitchToLogin={() => setAuthView("login")} />
      )}
    </main>
  );
}
