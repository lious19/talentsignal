import { createPool } from "./pool";
import { runMigrations } from "./migrate";

/**
 * S-12's own demo-data script: "Given seeded pipeline and placement data."
 * Same quarantine discipline as SeedJobBoardProvider (S-04) — a standalone
 * script, never wired into server.ts boot, invoked only by explicitly
 * running `npm run seed:analytics-demo`. Every client name is prefixed so
 * it's unmistakably fake and safely re-runnable: re-running only adds
 * clients from SEED_CLIENTS that aren't already present (see the
 * skip-existing note below main() — sales_pipeline_audit is genuinely
 * append-only per decision 013, so a delete-and-reinsert approach isn't an
 * option here, unlike other quarantined seed scripts).
 *
 * A fuller seed/reset story belongs to S-19 (same forward-pointer
 * seedJobBoardProvider.ts already uses) — this is scoped to what S-12 needs
 * to demo three KPIs across several months, including one reopen-then-reclose
 * pair so the event-based placements-per-month definition (06_decisions/020)
 * has something real to show.
 *
 * Extended for S-13 (clients 06+, below): the demand forecast
 * (06_decisions/021) needs a longer monthly history than S-12 ever did — the
 * original 5 clients only spanned Jan–May 2026 with an April gap, too short
 * to fit a trend or get a meaningful residual spread. The extension is
 * purely additive (existing clients 01–05 and their dates are untouched) and
 * reuses the exact same reopen-safe, prefix-scoped delete/reinsert. It also
 * bakes in one deliberate October 2025 spike (6 closings against a 1–3
 * baseline) so the forecast's outlier flag has something real to catch in
 * the live demo, not just in a unit test.
 *
 * Extended again for S-17 (OPEN_ROLES_BY_SUFFIX, below): segmentation
 * (06_decisions/025) buckets clients by open job_openings count, and this
 * script seeded zero job_openings rows before now — every client would have
 * landed in the same "low" bucket, showing nothing real. Purely additive,
 * same skip-existing discipline: only fires for a client this run actually
 * inserts, never touches a client that already exists.
 */
const SEED_PREFIX = "Seed Analytics Client";

interface SeedClient {
  name: string;
  events: Array<{ fromStage: string | null; toStage: string; changedAt: string }>;
}

// Suffix -> how many open job_openings to seed for that client, spanning all
// three SEGMENTATION_CONFIG buckets (0-1 low, 2-4 medium, 5+ high) so the
// live demo shows real segment variety. Every suffix not listed here gets
// zero — "low" by omission, not a special case.
const OPEN_ROLES_BY_SUFFIX: Record<string, number> = {
  "01": 1,
  "02": 3,
  "04": 6,
  "05": 2,
  "06": 8,
};

// A one-shot prospecting->closed client, for the S-13 seed extension below,
// where the only thing that matters is which month the closing lands in.
function simpleClosedClient(suffix: string, prospectingDate: string, closedDate: string): SeedClient {
  return {
    name: `${SEED_PREFIX} ${suffix}`,
    events: [
      { fromStage: null, toStage: "prospecting", changedAt: `${prospectingDate}T00:00:00Z` },
      { fromStage: "prospecting", toStage: "closed", changedAt: `${closedDate}T00:00:00Z` },
    ],
  };
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
  // --- S-13 extension below: more months of history for the demand
  // forecast, plus one deliberate spike month. One prospecting->closed pair
  // each, kept simple — these clients only exist to produce a placements
  // count in a specific month, not to exercise any other pipeline behavior.
  simpleClosedClient("06", "2025-06-01", "2025-06-15"),
  simpleClosedClient("07", "2025-06-05", "2025-06-20"),
  simpleClosedClient("08", "2025-07-01", "2025-07-15"),
  simpleClosedClient("09", "2025-08-01", "2025-08-12"),
  simpleClosedClient("10", "2025-08-05", "2025-08-22"),
  simpleClosedClient("11", "2025-09-01", "2025-09-10"),
  simpleClosedClient("12", "2025-09-03", "2025-09-15"),
  simpleClosedClient("13", "2025-09-05", "2025-09-25"),
  // October 2025 — the deliberate spike: 6 closings against a 1-3/month
  // baseline everywhere else, so the outlier flag has something unmistakable
  // to catch in the live demo (06_decisions/021).
  simpleClosedClient("14", "2025-10-01", "2025-10-05"),
  simpleClosedClient("15", "2025-10-01", "2025-10-08"),
  simpleClosedClient("16", "2025-10-02", "2025-10-11"),
  simpleClosedClient("17", "2025-10-02", "2025-10-14"),
  simpleClosedClient("18", "2025-10-03", "2025-10-18"),
  simpleClosedClient("19", "2025-10-03", "2025-10-22"),
  simpleClosedClient("20", "2025-11-01", "2025-11-10"),
  simpleClosedClient("21", "2025-11-02", "2025-11-20"),
  simpleClosedClient("22", "2025-12-01", "2025-12-08"),
  simpleClosedClient("23", "2025-12-02", "2025-12-15"),
  simpleClosedClient("24", "2025-12-03", "2025-12-22"),
  // Fills the April 2026 gap the original 5 clients left open.
  simpleClosedClient("25", "2026-04-01", "2026-04-10"),
  simpleClosedClient("26", "2026-04-02", "2026-04-20"),
];

async function main(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);

  // Skip-existing, not delete-and-reinsert: decision 013 makes
  // sales_pipeline_audit genuinely append-only — even this script's own
  // DELETE was rejected by that trigger the first time this ran against a
  // real database with prior seed data in it (found while verifying S-13).
  // "Safe to re-run" now means "adds only the clients not already present,"
  // which still lands at the same end state on a fresh database and never
  // touches a row a previous run already wrote.
  const { rows: existingClients } = await pool.query(
    "SELECT name FROM clients WHERE name LIKE $1",
    [`${SEED_PREFIX}%`],
  );
  const existingNames = new Set(existingClients.map((row) => row.name as string));
  const clientsToSeed = SEED_CLIENTS.filter((seedClient) => !existingNames.has(seedClient.name));

  for (const seedClient of clientsToSeed) {
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

    const suffix = seedClient.name.slice(SEED_PREFIX.length + 1);
    const openRoles = OPEN_ROLES_BY_SUFFIX[suffix] ?? 0;
    for (let i = 0; i < openRoles; i++) {
      await pool.query(
        `INSERT INTO job_openings (client_id, title) VALUES ($1, $2)`,
        [clientId, `Seed Analytics Role ${i + 1}`],
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
  console.log(
    `seeded ${clientsToSeed.length} new client(s), ${existingNames.size} already present, ` +
      `${SEED_CLIENTS.length} total prefixed "${SEED_PREFIX}"`,
  );
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("seedAnalyticsDemo failed:", err);
  process.exit(1);
});
