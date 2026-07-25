import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeClientRow {
  id: string;
  name: string;
  contact_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * In-memory stand-in for the clients table. Query matching is order-
 * sensitive: the WHERE-id SELECT/DELETE checks must run before the bare
 * "SELECT * FROM clients" / generic checks, since the shorter strings are
 * substrings of the longer ones.
 */
export function createFakeClientsPool() {
  const rows: FakeClientRow[] = [];
  let nextId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO clients")) {
      const [name, contactInfo] = params as [string, Record<string, unknown>];
      const now = new Date().toISOString();
      const row: FakeClientRow = {
        id: String(nextId++),
        name,
        contact_info: contactInfo,
        created_at: now,
        updated_at: now,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes("SELECT * FROM clients WHERE id")) {
      const [id] = params as [string];
      const match = rows.find((row) => row.id === id);
      return { rows: match ? [match] : [] };
    }

    if (sql.includes("SELECT * FROM clients")) {
      return { rows: [...rows].reverse() };
    }

    if (sql.includes("UPDATE clients")) {
      const [name, contactInfo, id] = params as [string, Record<string, unknown>, string];
      const match = rows.find((row) => row.id === id);
      if (!match) return { rows: [] };
      match.name = name;
      match.contact_info = contactInfo;
      match.updated_at = new Date().toISOString();
      return { rows: [match] };
    }

    if (sql.includes("DELETE FROM clients")) {
      const [id] = params as [string];
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return { rows: [] };
      const [deleted] = rows.splice(index, 1);
      return { rows: [{ id: deleted.id }] };
    }

    throw new Error(`fakeClientsPool: unexpected query — ${sql}`);
  });

  return { pool: { query } as unknown as Pool, rows };
}
