import type { ReactNode } from "react";

interface SidebarProps {
  // App.tsx still builds each RoleGate-wrapped nav button exactly as it did
  // before this redesign — Sidebar only supplies the persistent left-hand
  // frame (logo header + vertical list) around whatever nav items it's
  // handed. No role logic lives here.
  children: ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="main navigation">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">TS</span>
        <span className="sidebar-brand-name">TalentSignal</span>
      </div>
      <nav className="sidebar-nav">{children}</nav>
    </aside>
  );
}
