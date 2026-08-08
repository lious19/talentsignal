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

  return (
    <main>
      <h1>TalentSignal</h1>
      <section aria-label="backend health">
        {health.status === "loading" && <p>Checking backend...</p>}
        {health.status === "ok" && <p>Backend reachable — db: {health.db}</p>}
        {health.status === "error" && <p>Backend unreachable</p>}
      </section>

      {token ? (
        <>
          <button onClick={handleLogout}>Log out</button>
          {/* Role gates per 06_decisions/022's permission matrix — UX only,
              the backend requireRole gate is the real boundary. */}
          <RoleGate allow={["admin", "sales"]}>
            <section aria-label="opportunities">
              <h2>Opportunities</h2>
              <OpportunitiesList />
            </section>
          </RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            <ClientsScreen />
          </RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            <CandidatesScreen />
          </RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            <JobOpeningsScreen />
          </RoleGate>
          <RoleGate allow={["admin", "sales"]}>
            <MatchScreen />
          </RoleGate>
          <RoleGate allow={["admin", "sales"]}>
            <SalesPipelineBoard />
          </RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            <PackageReviewScreen />
          </RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            <RelationshipsPanel />
          </RoleGate>
          <RoleGate allow={["admin", "recruiter"]}>
            <RecommendationScreen />
          </RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            <AnalyticsDashboard />
          </RoleGate>
          {/* Staff-initiated privacy workflow, not a candidate-facing
              portal — there is no candidate login anywhere in this app
              (06_decisions/023). */}
          <RoleGate allow={["admin", "recruiter"]}>
            <PrivacyRequestScreen />
          </RoleGate>
        </>
      ) : authView === "login" ? (
        <LoginScreen onSuccess={setToken} onSwitchToRegister={() => setAuthView("register")} />
      ) : (
        <RegisterScreen onSuccess={setToken} onSwitchToLogin={() => setAuthView("login")} />
      )}
    </main>
  );
}
