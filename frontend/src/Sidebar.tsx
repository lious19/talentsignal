import { Menu, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

interface SidebarProps {
  // App.tsx still builds each RoleGate-wrapped nav button exactly as it did
  // before this redesign — Sidebar only supplies the persistent left-hand
  // frame (logo header + vertical list) around whatever nav items it's
  // handed. No role logic lives here.
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({ children, collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"} aria-label="main navigation">
      <div className="sidebar-brand">
        <Sparkles size={20} aria-hidden="true" className="sidebar-brand-mark" />
        <span className="sidebar-brand-name">TalentSignal</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="sidebar-collapse-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Menu size={15} aria-hidden="true" />
        </button>
      </div>
      <nav className="sidebar-nav">{children}</nav>
    </aside>
  );
}
