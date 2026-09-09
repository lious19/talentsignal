import { createPool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";
import { LcaProvider } from "../src/adapters/lcaProvider";
import { FederalAwardsProvider } from "../src/adapters/federalAwardsProvider";
import { FormDProvider } from "../src/adapters/formDProvider";
import { getTargetCompanyNames, ingestCapacitySignals } from "../src/ingestion/ingestCapacitySignals";

// LCA's 73MB download + streaming parse of ~1M rows needs real headroom --
// generous relative to ingestRequisitions.ts's 5s (a live board API call),
// since this is a one-off/occasional batch job, never on a request path.
const TIMEOUT_MS = 120_000;

/**
 * Manual trigger for S-24, mirrors scripts/ingest-once.ts's shape exactly --
 * run via `npm run ingest:capacity-once`. Not wired to boot, not on a cron:
 * capacity ingestion is explicitly a separate, occasional job
 * (06_decisions/047), same posture S-21 took for requisition ingestion
 * before a scheduler existed.
 */
if (require.main === module) {
  (async () => {
    const pool = createPool();
    await runMigrations(pool);

    // Resolved from the live opportunities table BEFORE constructing any
    // provider -- each provider needs the real list at construction time,
    // same as GreenhouseProvider/LeverProvider take boardTokens/
    // companyHandles at construction (see getTargetCompanyNames's own
    // comment in ingestCapacitySignals.ts).
    const targetCompanyNames = await getTargetCompanyNames(pool);
    // eslint-disable-next-line no-console
    console.log("target company names:", JSON.stringify(targetCompanyNames));

    const providers = {
      h1bLca: new LcaProvider(pool, targetCompanyNames),
      federalAward: new FederalAwardsProvider(pool, targetCompanyNames),
      formD: new FormDProvider(pool, targetCompanyNames),
    };
    const result = await ingestCapacitySignals(providers, { timeoutMs: TIMEOUT_MS, targetCompanyNames });

    // eslint-disable-next-line no-console
    console.log("ingestCapacitySignals complete:", JSON.stringify(result));
    await pool.end();
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("ingestCapacitySignals failed:", err);
    process.exit(1);
  });
}
