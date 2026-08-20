import type { FixtureContext } from "./setupFixtures";

/**
 * "read" endpoints get the 1->10->50->100->250->500 ladder (06_decisions/028).
 * "bulkWrite" is /hidden-demand/analyze alone, on its own 1->5->10 ladder --
 * it upserts the ENTIRE seed batch in one statement per call, so it competes
 * for the same 10-connection pool very differently than a bounded read, and
 * a statement_timeout there is the AC-4-2 cap firing by design, not a
 * throughput miss. Mixing it into the read ladder would make the whole run
 * look like it collapses at 50 concurrent when it's really one bulk-write
 * endpoint hitting its own cap -- see decision 028.
 * "login" is a single, bounded-request-count scenario (not duration-based),
 * because /auth/login is rate-limited to 10 requests/15min per IP.
 */
export type TierProfile = "read" | "bulkWrite" | "login";

export interface ScenarioRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface Scenario {
  name: string;
  profile: TierProfile;
  request: (ctx: FixtureContext) => ScenarioRequest;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/**
 * Order matters here, not just content: real runs showed the backend
 * degrading progressively over a long sustained multi-tier gauntlet and NOT
 * recovering within the drain cap, so whatever scenario runs LAST in a long
 * run risks measuring "an already-overwhelmed server" rather than its own
 * endpoint behavior. login and analyze run early (right after health) while
 * the server is still fresh, precisely because they are the cheapest/lowest
 * total request-volume scenarios to get clean data from and their absence
 * from a run tells you nothing about the heavier read endpoints. The
 * heaviest, most fragile endpoint (targeting, an O(opportunities *
 * candidates) join) runs last on purpose -- it's the one most likely to be
 * affected by cumulative degradation, and that risk is disclosed in the
 * results doc rather than hidden.
 */
export const scenarios: Scenario[] = [
  {
    name: "GET /api/health",
    profile: "read",
    request: (ctx) => ({ url: `${ctx.baseUrl}/api/health`, method: "GET", headers: {} }),
  },
  {
    name: "POST /api/auth/login",
    profile: "login",
    // Reuses the bootstrap admin's own credentials -- login has no side
    // effect worth avoiding repetition of (a SELECT + bcrypt.compare), unlike
    // register. Never routed through setupFixtures' one-time login.
    request: (ctx) => ({
      url: `${ctx.baseUrl}/api/auth/login`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      }),
    }),
  },
  {
    name: "POST /api/hidden-demand/analyze",
    profile: "bulkWrite",
    request: (ctx) => ({
      url: `${ctx.baseUrl}/api/hidden-demand/analyze`,
      method: "POST",
      headers: authHeaders(ctx.token),
    }),
  },
  {
    name: "GET /api/hidden-demand/opportunities",
    profile: "read",
    // includeSeedData=true: without it this measures ~2 mock rows, not real
    // volume -- see decision 028's seed-visibility finding.
    request: (ctx) => ({
      url: `${ctx.baseUrl}/api/hidden-demand/opportunities?includeSeedData=true`,
      method: "GET",
      headers: authHeaders(ctx.token),
    }),
  },
  {
    name: "POST /api/client-matchmaking/match",
    profile: "read",
    request: (ctx) => ({
      url: `${ctx.baseUrl}/api/client-matchmaking/match`,
      method: "POST",
      headers: authHeaders(ctx.token),
      body: JSON.stringify({ jobId: ctx.jobId }),
    }),
  },
  {
    name: "POST /api/recommendation-engine/recommend",
    profile: "read",
    request: (ctx) => ({
      url: `${ctx.baseUrl}/api/recommendation-engine/recommend`,
      method: "POST",
      headers: authHeaders(ctx.token),
      body: JSON.stringify({ jobId: ctx.jobId }),
    }),
  },
  {
    name: "GET /api/hard-to-fill/targeting",
    profile: "read",
    // includeSeedData=true requires hardToFillTargeting.ts's opt-in param
    // (06_decisions/028) -- without both that param AND the seed-title
    // keyword fix in seedJobBoardProvider.ts, this endpoint always returns
    // zero targets, regardless of concurrency.
    request: (ctx) => ({
      url: `${ctx.baseUrl}/api/hard-to-fill/targeting?includeSeedData=true`,
      method: "GET",
      headers: authHeaders(ctx.token),
    }),
  },
];
