import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken, getStoredRole } from "./auth";

interface Client {
  id: string;
  name: string;
  contactInfo?: { email?: string; phone?: string };
  createdAt: string;
}

type ClientsState =
  | { status: "loading" }
  | { status: "ok"; clients: Client[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// Matches the backend's PII_VISIBLE_ROLES (backend/src/routes/clients.ts) —
// only recruiter/admin can create/edit a client (the write routes are
// role-gated because both carry contactInfo), so the create form is hidden
// rather than shown-then-403'd for anyone else.
const CAN_MANAGE_ROLES = ["admin", "recruiter"];

export function ClientsScreen() {
  const [state, setState] = useState<ClientsState>({ status: "loading" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const role = getStoredRole();
  const canManage = role !== null && CAN_MANAGE_ROLES.includes(role);

  async function loadClients() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/clients", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error(`clients fetch failed: ${res.status}`);
      const body = (await res.json()) as { clients: Client[] };
      setState({ status: "ok", clients: body.clients });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  useEffect(() => {
    loadClients();
    // loadClients only reads from stable module-level storage helpers and
    // never changes identity across renders, so this only needs to run once.
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

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, contactInfo }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error ?? "failed to create client");
        return;
      }
      setName("");
      setEmail("");
      setPhone("");
      await loadClients();
    } catch {
      setFormError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="clients">
      <h2>Clients</h2>

      {canManage ? (
        <form onSubmit={handleSubmit} aria-label="create client">
          <div>
            <label htmlFor="client-name">Name</label>
            <br />
            <input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="client-email">Contact email</label>
            <br />
            <input
              id="client-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="client-phone">Contact phone</label>
            <br />
            <input
              id="client-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Add client"}
          </button>
        </form>
      ) : (
        <p>Only recruiters and admins can add clients.</p>
      )}
      {formError && <p role="alert">{formError}</p>}

      {state.status === "loading" && <p>Loading clients...</p>}
      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not load clients.</p>}
      {state.status === "ok" && state.clients.length === 0 && <p>No clients yet.</p>}
      {state.status === "ok" && state.clients.length > 0 && (
        <ul aria-label="client list">
          {state.clients.map((client) => (
            <li key={client.id}>
              <strong>{client.name}</strong>
              {client.contactInfo && (client.contactInfo.email || client.contactInfo.phone) && (
                <span>
                  {" — "}
                  {client.contactInfo.email}
                  {client.contactInfo.email && client.contactInfo.phone && " · "}
                  {client.contactInfo.phone}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
