import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeJobOpeningRow {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  requirements: string[];
  created_at: string;
  updated_at: string;
}

function fkViolation(): Error & { code: string } {
  const err = new Error(
    'insert or update on table "job_openings" violates foreign key constraint',
  ) as Error & { code: string };
  err.code = "23503";
  return err;
}

/**
 * In-memory stand-in for the job_openings table, plus the one thing that
 * matters for its foreign key: validClientIds mirrors clients actually
 * present (or not) in the real clients table, so INSERT/UPDATE against an
 * unknown client_id fails the same way Postgres's FK constraint would.
 */
export function createFakeJobOpeningsPool(validClientIds: string[] = []) {
  const rows: FakeJobOpeningRow[] = [];
  const clientIds = new Set(validClientIds);
  let nextId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO job_openings")) {
      const [clientId, title, description, requirements] = params as [
        string,
        string,
        string | null,
        string[],
      ];
      if (!clientIds.has(clientId)) throw fkViolation();
      const now = new Date().toISOString();
      const row: FakeJobOpeningRow = {
        id: String(nextId++),
        client_id: clientId,
        title,
        description,
        requirements,
        created_at: now,
        updated_at: now,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes("SELECT * FROM job_openings WHERE id")) {
      const [id] = params as [string];
      const match = rows.find((row) => row.id === id);
      return { rows: match ? [match] : [] };
    }

    if (sql.includes("SELECT * FROM job_openings")) {
      return { rows: [...rows].reverse() };
    }

    if (sql.includes("UPDATE job_openings")) {
      const [clientId, title, description, requirements, id] = params as [
        string,
        string,
        string | null,
        string[],
        string,
      ];
      if (!clientIds.has(clientId)) throw fkViolation();
      const match = rows.find((row) => row.id === id);
      if (!match) return { rows: [] };
      match.client_id = clientId;
      match.title = title;
      match.description = description;
      match.requirements = requirements;
      match.updated_at = new Date().toISOString();
      return { rows: [match] };
    }

    if (sql.includes("DELETE FROM job_openings")) {
      const [id] = params as [string];
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return { rows: [] };
      const [deleted] = rows.splice(index, 1);
      return { rows: [{ id: deleted.id }] };
    }

    throw new Error(`fakeJobOpeningsPool: unexpected query — ${sql}`);
  });

  return { pool: { query } as unknown as Pool, rows, clientIds };
}
