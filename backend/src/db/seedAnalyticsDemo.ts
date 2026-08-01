import { createPool } from "./pool";
import { runMigrations } from "./migrate";

/**
 * S-12's own demo-data script: "Given seeded pipeline and placement data."
 * Same quarantine discipline as SeedJobBoardProvider (S-04) — a standalone
 * script, never wired into server.ts boot, invoked only by explicitly
 * running `npm run seed:analytics-demo`. Every client name is prefixed so
 * it's unmistakably fake and safely re-runnable: re-running deletes and
 * re-inserts exactly the rows this script owns, never anyone else's data.
 *
 * A fuller seed/reset story belongs to S-19 (same forward-pointer
 * seedJobBoardProvider.ts already uses) — this is scoped to what S-12 needs
 * to demo three KPIs across several months, including one reopen-then-reclose
 * pair so the event-based placements-per-month definition (06_decisions/020)
 * has something real to show.
 */
const SEED_PREFIX = "Seed Analytics Client";

interface SeedClient {
  name: string;
  events: Array<{ fromStage: string | null; toStage: string; changedAt: string }>;
}

const SEED_CLIENTS: SeedClient[] = [
  {
    name: `${SEED_PREFIX} 01`,
    events: [
      { fromStage: null, toStage: "prospecting", changedAt: "2026-01-05T00:00:00Z" },
      { fromStage: "prospecting", toStage: "closed", changedAt: "2026-01-20T00:00:00Z" },
    ],
  },
  {
    name: `${SEED_PREFIX} 02`,
    events: [
      { fromStage: null, toStage: "prospecting", changedAt: "2026-02-01T00:00:00Z" },
      { fromStage: "prospecting", toStage: "closed", changedAt: "2026-02-18T00:00:00Z" },
    ],
  },
  {
    name: `${SEED_PREFIX} 03`,
    events: [
      { fromStage: null, toStage: "contacted", changedAt: "2026-02-10T00:00:00Z" },
      { fromStage: "contacted", toStage: "closed", changedAt: "2026-02-25T00:00:00Z" },
    ],
  },
  {
    // Reopen-then-reclose: two placement events (March and May) from one
    // original entry — the honest double-count 06_decisions/020 accepts.
    name: `${SEED_PREFIX} 04`,
    events: [
      { fromStage: null, toStage: "prospecting", changedAt: "2026-03-01T00:00:00Z" },
      { fromStage: "prospecting", toStage: "closed", changedAt: "2026-03-30T00:00:00Z" },
      { fromStage: "closed", toStage: "negotiation", changedAt: "2026-04-05T00:00:00Z" },
      { fromStage: "negotiation", toStage: "closed", changedAt: "2026-05-01T00:00:00Z" },
    ],
  },
  {
    // Still open — never closed, so it contributes to neither
    // placements-per-month nor time-to-hire. Present so the seeded Sales
    // Pipeline board isn't ALL closed deals.
    name: `${SEED_PREFIX} 05`,
    events: [{ fromStage: null, toStage: "negotiation", changedAt: "2026-04-10T00:00:00Z" }],
  },
];

async function main(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);

  const { rows: existingClients } = await pool.query(
    "SELECT id FROM clients WHERE name LIKE $1",
    [`${SEED_PREFIX}%`],
  );
  const existingIds = existingClients.map((row) => row.id as string);
  if (existingIds.length > 0) {
    await pool.query("DELETE FROM sales_pipeline_audit WHERE client_id = ANY($1)", [existingIds]);
    await pool.query("DELETE FROM sales_pipeline WHERE client_id = ANY($1)", [existingIds]);
    await pool.query("DELETE FROM clients WHERE id = ANY($1)", [existingIds]);
  }

  for (const seedClient of SEED_CLIENTS) {
    const { rows: clientRows } = await pool.query(
      "INSERT INTO clients (name) VALUES ($1) RETURNING id",
      [seedClient.name],
    );
    const clientId = clientRows[0].id as string;

    for (const event of seedClient.events) {
      await pool.query(
        `INSERT INTO sales_pipeline_audit (client_id, changed_by, from_stage, to_stage, changed_at)
         VALUES ($1, 'seed-analytics-demo', $2, $3, $4)`,
        [clientId, event.fromStage, event.toStage, event.changedAt],
      );
    }

    const finalEvent = seedClient.events[seedClient.events.length - 1];
    await pool.query(
      `INSERT INTO sales_pipeline (client_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [clientId, finalEvent.toStage, seedClient.events[0].changedAt, finalEvent.changedAt],
    );
  }

  // eslint-disable-next-line no-console
  console.log(`seeded ${SEED_CLIENTS.length} clients prefixed "${SEED_PREFIX}"`);
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("seedAnalyticsDemo failed:", err);
  process.exit(1);
});
