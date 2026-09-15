import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { getStoredToken, getStoredRole } from "./auth";

interface Candidate {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
  contactInfo?: { email?: string; phone?: string };
  createdAt: string;
}

type CandidatesState =
  | { status: "loading" }
  | { status: "ok"; candidates: Candidate[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// Matches the backend's PII_VISIBLE_ROLES (backend/src/routes/candidates.ts).
const CAN_MANAGE_ROLES = ["admin", "recruiter"];

export function CandidatesScreen() {
  const [state, setState] = useState<CandidatesState>({ status: "loading" });
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");
  const [experience, setExperience] = useState("");
  const [availability, setAvailability] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Visual stub only (S-26 fix2) -- no backend, no parsing. The parser is a
  // separate future story; this just shows Ali the intended drop-zone
  // pattern ahead of the demo.
  const [uploadToast, setUploadToast] = useState(false);
  const role = getStoredRole();
  const canManage = role !== null && CAN_MANAGE_ROLES.includes(role);
  // contactInfo only ever appears in the response for recruiter/admin — any
  // other role never sees the key at all, this isn't re-checking anything.
  const showContactInfo = canManage;

  async function loadCandidates() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/candidates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error(`candidates fetch failed: ${res.status}`);
      const body = (await res.json()) as { candidates: Candidate[] };
      setState({ status: "ok", candidates: body.candidates });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  useEffect(() => {
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const token = getStoredToken();
    const contactInfo: Record<string, string> = {};
    if (email.trim()) contactInfo.email = email.trim();
    if (phone.trim()) contactInfo.phone = phone.trim();
    const skillsArray = skills
      .split(",")
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0);

    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          skills: skillsArray,
          experience: experience.trim() ? Number(experience) : null,
          availability: availability.trim() || null,
          contactInfo,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error ?? "failed to create candidate");
        return;
      }
      setName("");
      setSkills("");
      setExperience("");
      setAvailability("");
      setEmail("");
      setPhone("");
      await loadCandidates();
    } catch {
      setFormError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  function handleUploadDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setUploadToast(true);
  }

  function handleUploadClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = () => setUploadToast(true);
    input.click();
  }

  return (
    <section aria-label="candidates">
      <h2>Candidates</h2>

      {canManage && (
        <div
          className="resume-upload-zone"
          aria-label="resume upload"
          onClick={handleUploadClick}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleUploadDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") handleUploadClick();
          }}
        >
          <p>Drop resume PDF or LinkedIn URL here</p>
          <p className="resume-upload-zone-hint">or click to browse</p>
        </div>
      )}
      {uploadToast && (
        <p role="status" className="resume-upload-toast">
          Coming soon — resume parsing not yet implemented.
          <button type="button" onClick={() => setUploadToast(false)} aria-label="dismiss">
            ✕
          </button>
        </p>
      )}

      {canManage ? (
        <form onSubmit={handleSubmit} aria-label="create candidate">
          <div>
            <label htmlFor="candidate-name">Name</label>
            <br />
            <input
              id="candidate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="candidate-skills">Skills (comma-separated)</label>
            <br />
            <input
              id="candidate-skills"
              value={skills}
              onChange={(event) => setSkills(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="candidate-experience">Years of experience</label>
            <br />
            <input
              id="candidate-experience"
              type="number"
              min={0}
              value={experience}
              onChange={(event) => setExperience(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="candidate-availability">Availability</label>
            <br />
            <input
              id="candidate-availability"
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="candidate-email">Contact email</label>
            <br />
            <input
              id="candidate-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="candidate-phone">Contact phone</label>
            <br />
            <input
              id="candidate-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Add candidate"}
          </button>
        </form>
      ) : (
        <p>Only recruiters and admins can add candidates.</p>
      )}
      {formError && <p role="alert">{formError}</p>}

      {state.status === "loading" && <p>Loading candidates...</p>}
      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not load candidates.</p>}
      {state.status === "ok" && state.candidates.length === 0 && <p>No candidates yet.</p>}
      {state.status === "ok" && state.candidates.length > 0 && (
        <ul aria-label="candidate list">
          {state.candidates.map((candidate) => (
            <li key={candidate.id}>
              <strong>{candidate.name}</strong>
              {candidate.skills.length > 0 && <span> — {candidate.skills.join(", ")}</span>}
              {candidate.experience !== null && <span> · {candidate.experience} yrs</span>}
              {candidate.availability && <span> · {candidate.availability}</span>}
              {showContactInfo &&
                candidate.contactInfo &&
                (candidate.contactInfo.email || candidate.contactInfo.phone) && (
                  <span>
                    {" · "}
                    {candidate.contactInfo.email}
                    {candidate.contactInfo.email && candidate.contactInfo.phone && " · "}
                    {candidate.contactInfo.phone}
                  </span>
                )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
