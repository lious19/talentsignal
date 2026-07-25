import { signAccessToken } from "../../src/auth/jwt";

export function salesAuthHeader(): string {
  return `Bearer ${signAccessToken({ sub: "user-1", role: "sales" })}`;
}

export function recruiterAuthHeader(): string {
  return `Bearer ${signAccessToken({ sub: "user-2", role: "recruiter" })}`;
}

export function adminAuthHeader(): string {
  return `Bearer ${signAccessToken({ sub: "user-3", role: "admin" })}`;
}
