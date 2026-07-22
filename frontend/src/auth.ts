// See 06_decisions/008-jwt-storage-location.md for why localStorage was
// chosen over an httpOnly cookie, and what would change that answer.
export const TOKEN_STORAGE_KEY = "ts_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}
