import { createApp } from "./app";
import { createPool, waitForDatabase } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { logger } from "./logger";

const port = Number(process.env.PORT ?? 4000);

async function main(): Promise<void> {
  const pool = createPool();

  await waitForDatabase(pool);

  const { applied } = await runMigrations(pool);
  logger.info({ applied }, "migrations applied");

  const app = createApp(pool);
  app.listen(port, () => {
    logger.info({ port }, "backend listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "startup failed");
  process.exit(1);
});
