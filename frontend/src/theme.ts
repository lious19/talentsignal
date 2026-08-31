// Display-only, same non-security status as auth.ts's ROLE_STORAGE_KEY --
// which color tokens render, nothing else. Kept separate from auth.ts since
// it isn't part of the auth/session lifecycle (not cleared on logout).
export const THEME_STORAGE_KEY = "ts_theme";
export type Theme = "light" | "dark";

export function getStoredTheme(): Theme {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// data-theme lives on <html> (documentElement), not <body> -- applying it
// before React mounts (see main.tsx) means it's already correct for the
// very first paint, no light-then-dark flash on reload.
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}
