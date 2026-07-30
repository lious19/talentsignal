import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeClientRow {
  id: string;
  name: string;
}

export interface FakeSalesPipelineRow {
  id: string;
  client_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface FakeSalesPipelineAuditRow {
  id: string;
  client_id: string;
  changed_by: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
}

/**
 * In-memory stand-in for sales_pipeline + sales_pipeline_audit. This is the
 * first fake pool that needs pool.connect() semantics, not just pool.query():
 * salesPipeline.ts's POST route is the first route in this codebase running a
 * real multi-statement transaction (BEGIN / advisory lock / SELECT /
 * INSERT+INSERT / COMMIT), so the fake has to hand back a client-like object
 * with its own .query()/.release(), matching what a real checked-out pg
 * client provides.
 *
 * Deliberately does NOT implement UPDATE/DELETE against
 * salesPipelineAudit — the real table's append-only guarantee is enforced by
 * a DB trigger this fake cannot and should not simulate; a test that
 * mistakenly tried to mutate an audit row here should hit "unexpected
 * client.query" and fail loudly, not silently succeed against a fake that's
 * more permissive than production.
 *
 * The advisory lock (pg_advisory_xact_lock) is a genuine no-op here: this
 * fake is single-threaded, so there's nothing to serialize. The concurrency
 * guarantee it provides in production is proven separately by
 * salesPipeline.concurrentEnrollment.integration.test.ts against a real
 * Postgres, which is the only thing that can actually race two connections.
 */
export function createFakeSalesPipelinePool() {
  const clients: FakeClientRow[] = [];
  const salesPipeline: FakeSalesPipelineRow[] = [];
  const salesPipelineAudit: FakeSalesPipelineAuditRow[] = [];
  let nextClientId = 1;
  let nextPipelineId = 1;
  let nextAuditId = 1;

  function seedClient(name = "Test Client"): FakeClientRow {
    const client: FakeClientRow = { id: `client-${nextClientId++}`, name };
    clients.push(client);
    return client;
  }

  // Plain pool.query() — only ever hit by the GET /sales-pipeline join.
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql.includes("FROM sales_pipeline sp JOIN clients")) {
      const rows = salesPipeline
        .map((row) => {
          const client = clients.find((c) => c.id === row.client_id);
          return client ? { ...row, client_name: client.name } : null;
        })
        .filter((row): row is FakeSalesPipelineRow & { client_name: string } => row !== null)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      return { rows };
    }
    throw new Error(`fakeSalesPipelinePool: unexpected pool.query — ${sql}`);
  });

  // The transaction client handed back by pool.connect().
  async function clientQuery(sql: string, params: unknown[] = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [] };
    }

    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [] };
    }

    if (sql.startsWith("SELECT * FROM sales_pipeline WHERE client_id")) {
      const [clientId] = params as [string];
      const row = salesPipeline.find((r) => r.client_id === clientId);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes("INSERT INTO sales_pipeline (")) {
      const [clientId, status] = params as [string, string];
      if (!clients.some((c) => c.id === clientId)) {
        // Mirrors a real FK-violation error shape (Postgres code 23503).
        throw { code: "23503", message: "insert or update on table \"sales_pipeline\" violates foreign key constraint" };
      }
      const now = new Date().toISOString();
      const existing = salesPipeline.find((r) => r.client_id === clientId);
      if (existing) {
        existing.status = status;
        existing.updated_at = now;
        return { rows: [existing] };
      }
      const row: FakeSalesPipelineRow = {
        id: `pipeline-${nextPipelineId++}`,
        client_id: clientId,
        status,
        created_at: now,
        updated_at: now,
      };
      salesPipeline.push(row);
      return { rows: [row] };
    }

    if (sql.includes("INSERT INTO sales_pipeline_audit")) {
      const [clientId, changedBy, fromStage, toStage] = params as [
        string,
        string,
        string | null,
        string,
      ];
      salesPipelineAudit.push({
        id: `audit-${nextAuditId++}`,
        client_id: clientId,
        changed_by: changedBy,
        from_stage: fromStage,
        to_stage: toStage,
        changed_at: new Date().toISOString(),
      });
      return { rows: [] };
    }

    throw new Error(`fakeSalesPipelinePool: unexpected client.query — ${sql}`);
  }

  const connect = vi.fn(async () => ({
    query: vi.fn(clientQuery),
    release: vi.fn(),
  }));

  return {
    pool: { query, connect } as unknown as Pool,
    seedClient,
    salesPipeline,
    salesPipelineAudit,
  };
}
