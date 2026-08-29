import { createPool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";
import { GreenhouseProvider } from "../src/adapters/greenhouseProvider";
import { LeverProvider } from "../src/adapters/leverProvider";
import { ingestRequisitions } from "../src/ingestion/ingestRequisitions";

// Matches hiddenDemand.ts's PROVIDER_TIMEOUT_MS -- same bound, real outbound
// HTTP this time instead of a mock.
const TIMEOUT_MS = 5_000;

function splitEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Manual trigger for S-21 -- run via `npm run ingest:once`. Not wired to
 * boot (server.ts is untouched) and not on a cron: this story ships the
 * trigger, a scheduler is explicitly deferred (see 06_decisions/040).
 * Mirrors seedDemo.ts's own CLI-entry shape.
 */
if (require.main === module) {
  (async () => {
    const pool = createPool();
    await runMigrations(pool);

    const greenhouseBoards = splitEnvList(process.env.GREENHOUSE_BOARDS);
    const leverCompanies = splitEnvList(process.env.LEVER_COMPANIES);

    const result = await ingestRequisitions(
      pool,
      {
        greenhouse: new GreenhouseProvider(pool, greenhouseBoards),
        lever: new LeverProvider(pool, leverCompanies),
      },
      { timeoutMs: TIMEOUT_MS },
    );

    // eslint-disable-next-line no-console
    console.log("ingestRequisitions complete:", JSON.stringify(result));
    await pool.end();
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("ingestRequisitions failed:", err);
    process.exit(1);
  });
}
