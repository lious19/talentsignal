import { signAccessToken } from "../../src/auth/jwt";

// Optional sub override, defaulting to each role's original fixed id, so
// every existing call site's behavior is unchanged. Added for S-14: the
// ownership trust scenario (06_decisions/022) needs two DISTINCT users of
// the SAME role (e.g. two recruiters) to prove one can't see the other's
// resource — a single fixed sub per role can't express that.
export function salesAuthHeader(sub = "user-1"): string {
  return `Bearer ${signAccessToken({ sub, role: "sales" })}`;
}

export function recruiterAuthHeader(sub = "user-2"): string {
  return `Bearer ${signAccessToken({ sub, role: "recruiter" })}`;
}

export function adminAuthHeader(sub = "user-3"): string {
  return `Bearer ${signAccessToken({ sub, role: "admin" })}`;
}
