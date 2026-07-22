import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; db: string }
  | { status: "error" };

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

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

  return (
    <main>
      <h1>TalentSignal</h1>
      <section aria-label="backend health">
        {health.status === "loading" && <p>Checking backend...</p>}
        {health.status === "ok" && <p>Backend reachable — db: {health.db}</p>}
        {health.status === "error" && <p>Backend unreachable</p>}
      </section>
    </main>
  );
}
