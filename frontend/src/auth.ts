// See 06_decisions/008-jwt-storage-location.md for why localStorage was
// chosen over an httpOnly cookie, and what would change that answer.
export const TOKEN_STORAGE_KEY = "ts_token";
// role is UI-only convenience (which screens/fields to render) — never a
// security boundary. The backend re-checks the role from the verified JWT on
// every request; this is just so components like CandidatesScreen don't have
// to decode the token themselves to decide whether to show contactInfo.
export const ROLE_STORAGE_KEY = "ts_role";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function getStoredRole(): string | null {
  return localStorage.getItem(ROLE_STORAGE_KEY);
}

export function storeRole(role: string): void {
  localStorage.setItem(ROLE_STORAGE_KEY, role);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(ROLE_STORAGE_KEY);
}
