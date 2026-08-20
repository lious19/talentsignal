import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { setupFixtures } from "./setupFixtures";
import { scenarios } from "./scenarios";
import { runTier, type TierResult } from "./runTier";

/**
 * Reflects 06_decisions/028's PROPOSED ladder. A future change to these
 * numbers is a one-line diff here plus a note in that decision file -- same
 * discipline as HARD_TO_FILL_CONFIG.
 */
const READ_LADDER = [1, 10, 50, 100, 250, 500];
const BULK_WRITE_LADDER = [1, 5, 10];
// Reduced from an originally-proposed 20s: this measurement environment (a
// sandboxed VM) could not reliably keep a >10-minute unattended process
// alive across session/wakeup boundaries -- Docker's own daemon was
// independently observed to stop mid-run twice. 8s still yields hundreds to
// low-thousands of requests per tier at every concurrency level actually
// run (see results doc's `requests` column), enough for a stable
// percentile. Documented as an environment constraint, not a silent
// shortcut -- see decision 028 and the results doc's methodology section.
const TIER_DURATION_SEC = 8;
// Setup already spends one login; this scenario's own request count is kept
// low enough that the two together stay well under the 10-req/15-min limit
// on /auth/login (auth.ts).
const LOGIN_CONNECTIONS = 4;
const LOGIN_AMOUNT = 8;

/**
 * Found during real runs (not hypothesized in advance): back-to-back tiers
 * with no gap let a saturated tier's backlog of pool-queued requests bleed
 * into the NEXT tier's measurement window -- a c=500 tier that leaves
 * hundreds of requests queued in db/pool.ts waiting for one of 10
 * connections produces errors and NaN latencies at the start of whatever
 * runs next, even a completely different, otherwise-idle endpoint at c=1.
 *
 * A FIXED cooldown turned out not to be enough: with only ~10 connections
 * served at a time and hundreds queued, the real drain time depends on how
 * deep the backlog got, not on connectionTimeoutMillis (5000ms) alone -- a
 * fixed 8s cooldown still left contamination after a truly saturated tier.
 * So this polls the cheapest real endpoint (/api/health, itself one
 * pool.query() away from the same pool) until ITS OWN round trip is fast
 * again -- direct evidence the pool has actually recovered, not a guess at
 * how long that takes.
 */
const DRAIN_POLL_INTERVAL_MS = 500;
const DRAIN_FAST_THRESHOLD_MS = 50;
// Also reduced (from an originally-proposed 60s) for the same environment
// reason as TIER_DURATION_SEC above. A capped-out drain still proceeds (with
// a printed warning) rather than hang indefinitely, so this bounds worst-case
// total runtime without silently hiding an incomplete drain.
const DRAIN_MAX_WAIT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDrain(baseUrl: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < DRAIN_MAX_WAIT_MS) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      const elapsed = Date.now() - t0;
      if (res.ok && elapsed < DRAIN_FAST_THRESHOLD_MS) return;
    } catch {
      // Still draining (timeout/connection refused) -- keep polling.
    }
    await sleep(DRAIN_POLL_INTERVAL_MS);
  }
  console.warn(
    `[load-test] WARNING: pool did not drain within ${DRAIN_MAX_WAIT_MS}ms -- ` +
      `proceeding anyway; the next tier's numbers may be contaminated by this one's backlog.`,
  );
}

function printRow(r: TierResult): void {
  console.log(
    `[${r.profile.padEnd(9)}] ${r.scenario.padEnd(42)} c=${String(r.concurrency).padEnd(4)} ` +
      `p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms p99=${r.p99.toFixed(1)}ms ` +
      `reqs=${r.requests} non2xx=${r.non2xx} errors=${r.errors}`,
  );
}

async function main(): Promise<void> {
  const backendPort = process.env.BACKEND_PORT ?? "4000";
  const baseUrl = `http://localhost:${backendPort}`;

  console.log(`[load-test] target: ${baseUrl}`);
  console.log(
    `[load-test] environment: ${os.cpus().length} CPUs, ` +
      `${(os.totalmem() / 1e9).toFixed(1)}GB RAM, ${os.platform()} ${os.release()}, ` +
      `node ${process.version}`,
  );
  if (process.env.MARKET_SIGNAL_PROVIDER !== "seed") {
    console.warn(
      "[load-test] WARNING: MARKET_SIGNAL_PROVIDER is not 'seed' -- " +
        "/hidden-demand/analyze and everything downstream of it will be measuring " +
        "the 2-row MockJobBoardProvider, not real volume. Restart the backend with " +
        "MARKET_SIGNAL_PROVIDER=seed and SEED_SIGNAL_COUNT set before trusting these numbers.",
    );
  }

  const ctx = await setupFixtures(baseUrl);
  console.log(
    `[load-test] fixtures ready: clientId=${ctx.clientId} jobId=${ctx.jobId} ` +
      `candidates=${ctx.candidateCount}`,
  );

  const results: TierResult[] = [];

  for (const scenario of scenarios) {
    if (scenario.profile === "read") {
      for (const connections of READ_LADDER) {
        await waitForDrain(baseUrl);
        const r = await runTier(scenario, ctx, { connections, duration: TIER_DURATION_SEC });
        results.push(r);
        printRow(r);
      }
    } else if (scenario.profile === "bulkWrite") {
      for (const connections of BULK_WRITE_LADDER) {
        await waitForDrain(baseUrl);
        const r = await runTier(scenario, ctx, { connections, duration: TIER_DURATION_SEC });
        results.push(r);
        printRow(r);
      }
    } else if (scenario.profile === "login") {
      await waitForDrain(baseUrl);
      const r = await runTier(scenario, ctx, {
        connections: LOGIN_CONNECTIONS,
        amount: LOGIN_AMOUNT,
      });
      results.push(r);
      printRow(r);
    }
  }

  const outDir = join(__dirname, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        baseUrl,
        generatedAt: new Date().toISOString(),
        environment: {
          cpus: os.cpus().length,
          totalMemGB: Number((os.totalmem() / 1e9).toFixed(1)),
          platform: os.platform(),
          release: os.release(),
          node: process.version,
          marketSignalProvider: process.env.MARKET_SIGNAL_PROVIDER ?? "(unset -> mock)",
          seedSignalCount: process.env.SEED_SIGNAL_COUNT ?? "(unset -> 500 default if seed)",
          dbPoolMax: process.env.DB_POOL_MAX ?? "(unset -> pg default 10)",
        },
        readLadder: READ_LADDER,
        bulkWriteLadder: BULK_WRITE_LADDER,
        tierDurationSec: TIER_DURATION_SEC,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n[load-test] wrote ${outFile}`);
}

main().catch((err) => {
  console.error("[load-test] failed:", err);
  process.exit(1);
});
