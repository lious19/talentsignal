import { UserRound } from "lucide-react";
import type { ReactNode } from "react";

interface TopBarProps {
  // The backend-health indicator — App.tsx already owns that fetch/state;
  // TopBar just renders whatever it's handed, same pattern as Sidebar.
  health: ReactNode;
  email: string | null;
  onLogout: () => void;
}

export function TopBar({ health, email, onLogout }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-health">{health}</div>
      <div className="topbar-user">
        <UserRound size={18} aria-hidden="true" />
        {email && <span className="topbar-email">{email}</span>}
        <button type="button" onClick={onLogout} className="topbar-logout">
          Log out
        </button>
      </div>
    </header>
  );
}
