import { useState, type FormEvent } from "react";
import { storeToken, storeRole, storeEmail } from "./auth";

interface LoginScreenProps {
  onSuccess: (token: string) => void;
  onSwitchToRegister: () => void;
}

export function LoginScreen({ onSuccess, onSwitchToRegister }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this, the browser's default behavior is a full-page form
    // submission (a real HTTP POST + navigation), which would throw away
    // React's state and reload the page. We want to send the request
    // ourselves via fetch instead.
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // fetch only rejects on a network failure — a 401 or 500 still
      // resolves normally, so the error has to be read from the body and
      // res.ok checked explicitly.
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "login failed");
        return;
      }

      storeToken(body.token);
      storeRole(body.user.role);
      storeEmail(body.user.email ?? email);
      onSuccess(body.token);
    } catch {
      setError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <section aria-label="login" className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">TS</span>
          <span className="auth-brand-name">TalentSignal</span>
        </div>
        <h2>Log in</h2>
        <p className="auth-subtitle">Sign in to your account</p>
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="login-email">Email</label>
            <br />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="login-password">Password</label>
            <br />
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={submitting} className="auth-submit">
            {submitting ? "Logging in..." : "Log in"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p className="auth-switch">
          No account?{" "}
          <button type="button" onClick={onSwitchToRegister}>
            Register
          </button>
        </p>
      </section>
    </div>
  );
}
