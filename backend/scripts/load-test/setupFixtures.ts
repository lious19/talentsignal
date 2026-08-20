import { randomUUID } from "node:crypto";

/**
 * How many candidates the fixture creates via real HTTP POSTs (one round
 * trip each — there is no bulk-create endpoint). Deliberately small: S-18
 * measures endpoint behavior under CONCURRENCY at a fixed data-volume
 * operating point, not data-volume scaling. Row-count scaling is already
 * covered by the existing single-request AC-4-2/AC-4-3
 * *.latency.integration.test.ts files (5,000-10,000 rows, seeded via direct
 * SQL). Results doc states this explicitly so the two are never confused.
 */
const CANDIDATE_COUNT = 20;

export interface FixtureContext {
  baseUrl: string;
  token: string;
  jobId: string;
  clientId: string;
  candidateCount: number;
}

interface FetchJsonOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  expectStatus: number;
}

async function fetchJson(url: string, opts: FetchJsonOptions): Promise<any> {
  const res = await fetch(url, { method: opts.method, headers: opts.headers, body: opts.body });
  const text = await res.text();
  const parsed = text.length > 0 ? JSON.parse(text) : undefined;
  if (res.status !== opts.expectStatus) {
    throw new Error(
      `${opts.method} ${url} -> ${res.status} (expected ${opts.expectStatus}): ${text}`,
    );
  }
  return parsed;
}

/**
 * Runs once per harness invocation, never per virtual user: logs in as the
 * bootstrap admin ONE time and returns a token every scenario/tier reuses.
 * This is structural, not just a convention — nothing in run.ts/runTier.ts
 * ever calls /api/auth/login except this one call plus the dedicated,
 * bounded login scenario (see scenarios.ts), because /auth/login is
 * rate-limited to 10 requests/15min per IP (auth.ts) and a per-VU login
 * would blow through that in the first second of any tier.
 */
export async function setupFixtures(baseUrl: string): Promise<FixtureContext> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be set in the environment the harness " +
        "runs in (the same values the backend booted with) -- the harness authenticates once " +
        "as the bootstrap admin. Load them from the repo's .env, e.g. on Windows PowerShell: " +
        "Get-Content ..\\.env | ForEach-Object { ... } or just export them before running.",
    );
  }

  const loginBody = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    expectStatus: 200,
  });
  const token = loginBody.token as string;
  const authHeaders = { "content-type": "application/json", authorization: `Bearer ${token}` };

  const client = await fetchJson(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: `Load Test Client ${randomUUID()}` }),
    expectStatus: 201,
  });

  // Title deliberately contains a HARD_TO_FILL_CONFIG.roleKeywords match
  // ("data scientist") -- not because job_openings.title feeds
  // hardToFillScore.ts (it doesn't; only MarketSignal.title from the seed
  // provider does), but so client-matchmaking/recommendation-engine are
  // matching against a realistic, non-trivial requirements list.
  const job = await fetchJson(`${baseUrl}/api/job-openings`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      clientId: client.id,
      title: "Load Test Data Scientist",
      requirements: ["python", "sql", "machine learning"],
    }),
    expectStatus: 201,
  });

  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    const skills =
      i % 3 === 0
        ? ["python", "sql", "machine learning"]
        : i % 3 === 1
          ? ["python", "sql"]
          : ["cobol"];
    await fetchJson(`${baseUrl}/api/candidates`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: `Load Test Candidate ${i}`, skills, experience: i % 15 }),
      expectStatus: 201,
    });
  }

  return { baseUrl, token, jobId: job.id as string, clientId: client.id as string, candidateCount: CANDIDATE_COUNT };
}
