import { createApp } from "./app";
import { createPool, waitForDatabase } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { getJwtSecret } from "./auth/jwt";
import { bootstrapAdmin } from "./auth/adminBootstrap";
import { logger } from "./logger";
import { MockJobBoardProvider } from "./adapters/mockJobBoardProvider";
import { SeedJobBoardProvider } from "./adapters/seedJobBoardProvider";
import type { MarketSignalProvider } from "./adapters/marketSignalProvider";

const port = Number(process.env.PORT ?? 4000);

async function main(): Promise<void> {
  // Fail fast, before touching the database: a missing/weak JWT_SECRET
  // should stop the container from starting at all, not surface later as
  // every login silently 500ing while /health still reports green.
  getJwtSecret();

  const pool = createPool();

  await waitForDatabase(pool);

  const { applied } = await runMigrations(pool);
  logger.info({ applied }, "migrations applied");

  await bootstrapAdmin(pool);

  // The only place that decides which MarketSignalProvider is real: a real
  // job-board adapter would be constructed here instead, with no change to
  // createApp, the route, or the scoring code. Defaults to the single-signal
  // mock — the deployed demo never runs the seed batch unless someone
  // explicitly opts in. MARKET_SIGNAL_PROVIDER=seed is for local/demo use to
  // show a ranked board and measure the AC-4-2 latency target; row count via
  // SEED_SIGNAL_COUNT (default 500 — enough to see ranking without a slow
  // startup). See SeedJobBoardProvider for why it's never the default.
  const marketSignalProvider: MarketSignalProvider =
    process.env.MARKET_SIGNAL_PROVIDER === "seed"
      ? new SeedJobBoardProvider(Number(process.env.SEED_SIGNAL_COUNT ?? 500))
      : new MockJobBoardProvider();
  const app = createApp(pool, marketSignalProvider);
  app.listen(port, () => {
    logger.info({ port }, "backend listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "startup failed");
  process.exit(1);
});
