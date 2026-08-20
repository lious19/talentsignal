// eslint-disable-next-line @typescript-eslint/no-var-requires
const autocannon = require("autocannon");
import type { Scenario } from "./scenarios";
import type { FixtureContext } from "./setupFixtures";

export interface TierResult {
  scenario: string;
  profile: string;
  concurrency: number;
  requests: number;
  errors: number;
  non2xx: number;
  p50: number;
  p95: number;
  p99: number;
  throughputRps: number;
}

/**
 * autocannon's own result.latency object reports p50/p75/p90/p97_5/p99 --
 * there is no p50/p95/p99 triple built in, and REQ-017's target is p95
 * specifically. Rather than approximate p95 from p90/p97_5, this listens to
 * autocannon's per-request "response" event (emitted once per completed
 * request with the real response time) and computes p50/p95/p99 directly
 * from the raw sample -- an exact measurement, not an interpolation, per the
 * trust scenario's "never a fabricated or cherry-picked number."
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

export function runTier(
  scenario: Scenario,
  ctx: FixtureContext,
  opts: { connections: number; duration?: number; amount?: number },
): Promise<TierResult> {
  const req = scenario.request(ctx);
  const responseTimes: number[] = [];
  let non2xx = 0;

  // autocannon's validator rejects an explicitly-present-but-undefined
  // `duration` (or `amount`) key -- it must be entirely absent, not just
  // undefined, when the other one is used instead (duration-based read/
  // bulk-write tiers vs. the amount-based login scenario).
  const autocannonOpts: Record<string, unknown> = {
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: req.body,
    connections: opts.connections,
    // Client-side request timeout (seconds) -- separate from and longer
    // than db/pool.ts's 5000ms statement_timeout, so a server-side
    // statement-timeout rejection is captured as a real (non-2xx/error)
    // response rather than swallowed as a client timeout.
    timeout: 10,
  };
  if (opts.duration !== undefined) autocannonOpts.duration = opts.duration;
  if (opts.amount !== undefined) autocannonOpts.amount = opts.amount;

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      autocannonOpts,
      (err: Error | null, result: any) => {
        if (err) {
          reject(err);
          return;
        }
        const sorted = [...responseTimes].sort((a, b) => a - b);
        resolve({
          scenario: scenario.name,
          profile: scenario.profile,
          concurrency: opts.connections,
          requests: result.requests.total,
          errors: result.errors,
          non2xx,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          throughputRps: result.requests.average,
        });
      },
    );

    instance.on("response", (_client: unknown, statusCode: number, _resBytes: number, responseTime: number) => {
      responseTimes.push(responseTime);
      if (statusCode < 200 || statusCode >= 300) non2xx++;
    });
  });
}
