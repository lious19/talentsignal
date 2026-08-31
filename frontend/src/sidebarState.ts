// Display-only persistence, same pattern as theme.ts -- which layout state
// renders, nothing security- or session-related.
export const SIDEBAR_STORAGE_KEY = "ts_sidebar";
export type SidebarState = "open" | "closed";

export function getStoredSidebarState(): SidebarState {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "closed" ? "closed" : "open";
}

export function storeSidebarState(state: SidebarState): void {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
}
