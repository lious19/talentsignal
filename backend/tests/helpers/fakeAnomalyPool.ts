import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeAuditRow {
  to_stage: string;
  changed_at: string;
}

export interface FakeClientRow {
  id: string;
  name: string;
}

interface FakeAnomalyAuditRow {
  metric: string;
  month: string;
  step: string;
  actor: string;
  detail: unknown;
}

/**
 * In-memory stand-in for every table revenueAnomalies.ts touches:
 * sales_pipeline_audit (read-only, same shape as fakeAnalyticsPool.ts's own
 * placements query), clients, job_openings, anomaly_thresholds, and
 * anomaly_audit. Supports both pool.query() (the GET route) and
 * pool.connect() transaction semantics (the POST /decide route) — same
 * two-mode shape fakeSalesPipelinePool.ts established for S-08's first
 * transactional route.
 *
 * The advisory lock is a genuine no-op here, same reasoning
 * fakeSalesPipelinePool.ts gives: this fake is single-threaded, so there's
 * nothing to serialize. The real race guarantee is proven separately by
 * revenueAnomalies.suppressTrust.integration.test.ts against real Postgres.
 */
export function createFakeAnomalyPool() {
  const auditRows: FakeAuditRow[] = [];
  const clients: FakeClientRow[] = [];
  const openRolesByClient = new Map<string, number>();
  const thresholds = new Map<string, { kStdDev: number; updatedAt: string }>();
  const anomalyAudit: FakeAnomalyAuditRow[] = [];

  function seedAuditRow(toStage: string, changedAt: string): void {
    auditRows.push({ to_stage: toStage, changed_at: changedAt });
  }

  function seedClient(id: string, name: string, openRoles = 0): FakeClientRow {
    const client: FakeClientRow = { id, name };
    clients.push(client);
    if (openRoles > 0) openRolesByClient.set(id, openRoles);
    return client;
  }

  function placementsRows() {
    const counts = new Map<string, number>();
    for (const row of auditRows) {
      if (row.to_stage !== "closed") continue;
      const month = row.changed_at.slice(0, 7);
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([month, count]) => ({ month, count }));
  }

  function thresholdRows(metric: string) {
    const entry = thresholds.get(metric);
    return entry ? [{ metric, k_std_dev: String(entry.kStdDev), updated_at: entry.updatedAt }] : [];
  }

  // Shared between pool.query() and the transaction client.query() — every
  // read-only SELECT this route issues is identical in both modes.
  function sharedRead(sql: string, params: unknown[]): { rows: unknown[] } | null {
    if (sql.includes("FROM sales_pipeline_audit") && sql.includes("GROUP BY month")) {
      return { rows: placementsRows() };
    }
    if (sql.includes("FROM anomaly_thresholds WHERE metric")) {
      const [metric] = params as [string];
      return { rows: thresholdRows(metric) };
    }
    return null;
  }

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const shared = sharedRead(sql, params);
    if (shared) return shared;

    if (sql.includes("SELECT DISTINCT ON (month)")) {
      const [metric] = params as [string];
      const latestByMonth = new Map<string, string>();
      anomalyAudit.forEach((row) => {
        if (row.metric === metric) latestByMonth.set(row.month, row.step);
      });
      return { rows: [...latestByMonth.entries()].map(([month, step]) => ({ month, step })) };
    }

    if (sql.includes("SELECT id, name FROM clients")) {
      return { rows: [...clients].sort((a, b) => (a.name < b.name ? -1 : 1)) };
    }

    if (sql.includes("FROM job_openings GROUP BY client_id")) {
      return { rows: [...openRolesByClient.entries()].map(([client_id, open_roles]) => ({ client_id, open_roles })) };
    }

    throw new Error(`fakeAnomalyPool: unexpected pool.query — ${sql}`);
  });

  async function clientQuery(sql: string, params: unknown[] = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [] };
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [] };
    }

    const shared = sharedRead(sql, params);
    if (shared) return shared;

    if (sql.includes("INSERT INTO anomaly_thresholds")) {
      const [metric, kStdDev] = params as [string, number];
      thresholds.set(metric, { kStdDev, updatedAt: new Date().toISOString() });
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO anomaly_audit")) {
      const [metric, month, step, actor, detail] = params as [string, string, string, string, string];
      anomalyAudit.push({ metric, month, step, actor, detail: JSON.parse(detail) });
      return { rows: [] };
    }

    throw new Error(`fakeAnomalyPool: unexpected client.query — ${sql}`);
  }

  const connect = vi.fn(async () => ({
    query: vi.fn(clientQuery),
    release: vi.fn(),
  }));

  return {
    pool: { query, connect } as unknown as Pool,
    seedAuditRow,
    seedClient,
    thresholds,
    anomalyAudit,
  };
}
