import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeCandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
  contact_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** In-memory stand-in for the candidates table — same shape/ordering caveat as fakeClientsPool. */
export function createFakeCandidatesPool() {
  const rows: FakeCandidateRow[] = [];
  let nextId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO candidates")) {
      const [name, skills, experience, availability, contactInfo] = params as [
        string,
        string[],
        number | null,
        string | null,
        Record<string, unknown>,
      ];
      const now = new Date().toISOString();
      const row: FakeCandidateRow = {
        id: String(nextId++),
        name,
        skills,
        experience,
        availability,
        contact_info: contactInfo,
        created_at: now,
        updated_at: now,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes("SELECT * FROM candidates WHERE id")) {
      const [id] = params as [string];
      const match = rows.find((row) => row.id === id);
      return { rows: match ? [match] : [] };
    }

    if (sql.includes("SELECT * FROM candidates")) {
      return { rows: [...rows].reverse() };
    }

    if (sql.includes("UPDATE candidates")) {
      const [name, skills, experience, availability, contactInfo, id] = params as [
        string,
        string[],
        number | null,
        string | null,
        Record<string, unknown>,
        string,
      ];
      const match = rows.find((row) => row.id === id);
      if (!match) return { rows: [] };
      match.name = name;
      match.skills = skills;
      match.experience = experience;
      match.availability = availability;
      match.contact_info = contactInfo;
      match.updated_at = new Date().toISOString();
      return { rows: [match] };
    }

    if (sql.includes("DELETE FROM candidates")) {
      const [id] = params as [string];
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return { rows: [] };
      const [deleted] = rows.splice(index, 1);
      return { rows: [{ id: deleted.id }] };
    }

    throw new Error(`fakeCandidatesPool: unexpected query — ${sql}`);
  });

  return { pool: { query } as unknown as Pool, rows };
}
