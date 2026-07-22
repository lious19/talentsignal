import { signAccessToken } from "../../src/auth/jwt";

export function salesAuthHeader(): string {
  return `Bearer ${signAccessToken({ sub: "user-1", role: "sales" })}`;
}
