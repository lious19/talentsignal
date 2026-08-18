import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";

interface Student {
  id: string;
  name: string;
  experience: number | null;
  availability: string | null;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
}

interface Target {
  opportunityId: string;
  company: string;
  title: string;
  roleType: string | null;
  requirements: string[];
  hardToFillScore: number;
  hardToFillReasons: string[];
  students: Student[];
}

type TargetingState =
  | { status: "loading" }
  | { status: "ok"; targets: Target[] }
  | { status: "unauthenticated" }
  | { status: "error" };

export function HardToFillTargeting() {
  const [state, setState] = useState<TargetingState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/hard-to-fill/targeting", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`targeting fetch failed: ${res.status}`);
        return res.json() as Promise<{ targets: Target[] }>;
      })
      .then((body) => {
        if (!cancelled) setState({ status: "ok", targets: body.targets });
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

  if (state.status === "loading") return <p>Loading targeting...</p>;
  if (state.status === "unauthenticated") return <p>Your session has expired. Please log in again.</p>;
  if (state.status === "error") return <p>Could not load targeting.</p>;
  if (state.targets.length === 0) return <p>No hard-to-fill roles to target yet.</p>;

  return (
    <div>
      {/* The whole point of the trust scenario (HF-3): this is a SUGGESTION.
          A human decides who to submit; the app never submits anyone. There is
          deliberately no "submit" control anywhere on this screen. */}
      <p role="note">
        Suggested matches — a human decides who to submit. Nothing is submitted automatically.
      </p>
      <ul aria-label="hard-to-fill targeting">
        {state.targets.map((target) => (
          <li key={target.opportunityId}>
            <strong>{target.title}</strong> @ {target.company}{" "}
            <span>🔴 {Math.round(target.hardToFillScore * 100)}% hard to fill</span>
            {" — "}
            <span>{target.hardToFillReasons.join(", ")}</span>
            <div>
              <em>Needs:</em> {target.requirements.join(", ")}
            </div>
            <ol aria-label={`students for ${target.title}`}>
              {target.students.map((student) => (
                <li key={student.id}>
                  <strong>{student.name}</strong> — {Math.round(student.fitScore * 100)}% fit
                  {" — "}
                  {student.matchedSkills.length > 0
                    ? `matched: ${student.matchedSkills.join(", ")}`
                    : "no matching skills"}
                  {" · "}
                  <span>{student.reasons.join("; ")}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}
