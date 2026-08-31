import { useEffect, useRef, useState } from "react";
import { ChevronDown, Moon, Sun, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "./theme";
import { getStoredRole } from "./auth";

interface TopBarProps {
  // The backend-health indicator — App.tsx already owns that fetch/state;
  // TopBar just renders whatever it's handed, same pattern as Sidebar.
  health: ReactNode;
  email: string | null;
  onLogout: () => void;
}

function roleLabel(role: string | null): string | null {
  if (!role) return null;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function TopBar({ health, email, onLogout }: TopBarProps) {
  // Lazy initializer reads the attribute main.tsx already applied before
  // mount (see theme.ts), so this never disagrees with what's on screen.
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
  }

  // Click-outside and Escape both close the dropdown -- standard menu
  // behavior, no library needed for either.
  useEffect(() => {
    if (!profileOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

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

        <div className="topbar-profile" ref={profileRef}>
          <button
            type="button"
            className="topbar-profile-trigger"
            onClick={() => setProfileOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={profileOpen}
          >
            <UserRound size={18} aria-hidden="true" />
            {email && <span className="topbar-email">{email}</span>}
            <ChevronDown size={14} aria-hidden="true" className={profileOpen ? "chevron open" : "chevron"} />
          </button>

          {profileOpen && (
            <div className="topbar-profile-menu" role="menu">
              <div className="topbar-profile-menu-header">
                <UserRound size={18} aria-hidden="true" />
                <span className="topbar-profile-menu-email">{email ?? "Unknown user"}</span>
              </div>
              {roleLabel(getStoredRole()) && (
                <span className="topbar-profile-menu-role">{roleLabel(getStoredRole())}</span>
              )}
              <hr className="topbar-profile-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="topbar-profile-menu-item"
                onClick={onLogout}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
