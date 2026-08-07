import type { ReactNode } from "react";
import { getStoredRole } from "./auth";

interface RoleGateProps {
  allow: string[];
  children: ReactNode;
}

// Extracted from the identical inline check CandidatesScreen.tsx and
// ClientsScreen.tsx already had (CAN_MANAGE_ROLES + getStoredRole()) so
// App.tsx (06_decisions/022) can apply the same pattern to whole screens,
// not just form fields, without a third copy of the check.
//
// UX only, never the security boundary — same as auth.ts's own comment on
// ROLE_STORAGE_KEY. The backend's requireRole gate is what actually
// protects data; this only decides whether to mount a screen at all.
export function RoleGate({ allow, children }: RoleGateProps) {
  const role = getStoredRole();
  if (role === null || !allow.includes(role)) return null;
  return <>{children}</>;
}
