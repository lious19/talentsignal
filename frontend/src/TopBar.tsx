import { useState } from "react";
import { Moon, Sun, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "./theme";

interface TopBarProps {
  // The backend-health indicator — App.tsx already owns that fetch/state;
  // TopBar just renders whatever it's handed, same pattern as Sidebar.
  health: ReactNode;
  email: string | null;
  onLogout: () => void;
}

export function TopBar({ health, email, onLogout }: TopBarProps) {
  // Lazy initializer reads the attribute main.tsx already applied before
  // mount (see theme.ts), so this never disagrees with what's on screen.
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
  }

  return (
    <header className="topbar">
      <div className="topbar-health">{health}</div>
      <div className="topbar-user">
        <button
          type="button"
          onClick={toggleTheme}
          className="topbar-theme-toggle"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
        <UserRound size={18} aria-hidden="true" />
        {email && <span className="topbar-email">{email}</span>}
        <button type="button" onClick={onLogout} className="topbar-logout">
          Log out
        </button>
      </div>
    </header>
  );
}
