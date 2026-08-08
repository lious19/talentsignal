import type { Pool } from "pg";

// Accepts either a Pool or a PoolClient (pool.connect()'s transaction
// handle) — both satisfy this shape, which is all these functions need.
// Lets the route run every step of a privacy request on the same
// transaction client, the same discipline opportunityPackage.ts's release
// handler uses for its own multi-statement writes.
type Queryable = Pick<Pool, "query">;

export type ErasureStrategy = "reset_to_empty" | "anonymize" | "retain_exempt";

// The only two tables a privacy request can target — the registry may (and
// does) hold rows for other tables too (sales_pipeline_audit.changed_by,
// etc.), but those are never reachable through this module: every function
// below scopes its pii_fields read to exactly one of these two tables.
export type PrivacySubjectType = "candidate" | "client";
export type PrivacySubjectTable = "candidates" | "clients";

export const SUBJECT_TABLE_BY_TYPE: Record<PrivacySubjectType, PrivacySubjectTable> = {
  candidate: "candidates",
  client: "clients",
};

const SUBJECT_TABLES: readonly PrivacySubjectTable[] = ["candidates", "clients"];

// Fixed, not derived from the anonymized column's own type or content — a
// deliberately simple choice (06_decisions/023): stays correct as new TEXT
// anonymize-columns are registered, without needing to invent per-column
// placeholder text. candidates.name is the only anonymize column today.
const ANONYMIZE_PLACEHOLDER = "[erased]";

// Defense in depth: pii_fields rows are trusted today (seeded only by
// migrations, never by request input), but table/column names still can't
// be parameterized the way values can — pg only parameterizes $1/$2/etc.
// This guards against a future migration ever adding a row whose name
// wouldn't be safe to interpolate.
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

function quoteIdent(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`refusing to build SQL from unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

function assertSubjectTable(tableName: string): asserts tableName is PrivacySubjectTable {
  if (!SUBJECT_TABLES.includes(tableName as PrivacySubjectTable)) {
    throw new Error(`unsupported privacy subject table: ${tableName}`);
  }
}

export interface PiiFieldRow {
  table_name: string;
  column_name: string;
  category: string;
  erasure_strategy: ErasureStrategy;
  redact_from_display: boolean;
}

/**
 * Loads the pii_fields rows registered for ONE subject table
 * (candidates or clients) — S-05's registry, read at runtime for the first
 * time here. Scoping to a single table is what keeps every loop below from
 * ever reaching an unrelated table like sales_pipeline_audit, which sits
 * behind its own append-only trigger (06_decisions/013) — a request for a
 * candidate simply never sees that table's registry row at all.
 */
export async function loadPiiFields(
  db: Queryable,
  tableName: PrivacySubjectTable,
): Promise<PiiFieldRow[]> {
  assertSubjectTable(tableName);
  const { rows } = await db.query(
    `SELECT table_name, column_name, category, erasure_strategy, redact_from_display
     FROM pii_fields WHERE table_name = $1`,
    [tableName],
  );
  return rows as PiiFieldRow[];
}

/**
 * "What do you hold on me" — every registered column's current value from
 * the subject's own row. Symmetric with applyErasure below, and for the
 * same reason: the registry is the one generic, honest source of "what
 * counts as PII we hold" (06_decisions/023) — this does not chase copies of
 * a person's data embedded in other tables (e.g. a candidate's name inside
 * opportunity_packages.content).
 */
export async function collectAccessPayload(
  db: Queryable,
  tableName: PrivacySubjectTable,
  subjectId: string,
  fields: PiiFieldRow[],
): Promise<{ found: boolean; values: Record<string, unknown> }> {
  assertSubjectTable(tableName);
  const { rows } = await db.query(`SELECT * FROM ${quoteIdent(tableName)} WHERE id = $1`, [
    subjectId,
  ]);
  if (rows.length === 0) return { found: false, values: {} };

  const row = rows[0] as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.column_name] = row[field.column_name];
  }
  return { found: true, values };
}

async function emptyValueFor(
  db: Queryable,
  tableName: PrivacySubjectTable,
  columnName: string,
): Promise<unknown> {
  // Scoped to current_schema(): the DB-gated tests run full migrations
  // against a throwaway, isolated schema per test run (search_path set to
  // that schema), so an unscoped lookup against information_schema.columns
  // could otherwise match a same-named column in a different schema.
  const { rows } = await db.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [tableName, columnName],
  );
  const dataType = rows[0]?.data_type as string | undefined;
  return dataType === "jsonb" || dataType === "json" ? {} : "";
}

export interface ErasureSummary {
  columnsErased: string[];
  columnsRetained: string[];
}

/**
 * Loops the registry and applies each column's erasure_strategy — the
 * whole payoff of S-05's PII tagging: no hardcoded column list, so this
 * stays correct as columns are added. retain_exempt is skipped entirely —
 * never even attempted as an UPDATE, which matters because a retain_exempt
 * column elsewhere in this schema (changed_by, released_by) sits behind an
 * append-only trigger that would reject it outright (06_decisions/013);
 * this function must never get the chance to find that out at runtime.
 */
export async function applyErasure(
  db: Queryable,
  tableName: PrivacySubjectTable,
  subjectId: string,
  fields: PiiFieldRow[],
): Promise<ErasureSummary> {
  assertSubjectTable(tableName);
  const columnsErased: string[] = [];
  const columnsRetained: string[] = [];

  for (const field of fields) {
    if (field.erasure_strategy === "retain_exempt") {
      columnsRetained.push(field.column_name);
      continue;
    }

    const value =
      field.erasure_strategy === "anonymize"
        ? ANONYMIZE_PLACEHOLDER
        : await emptyValueFor(db, tableName, field.column_name);

    await db.query(
      `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(field.column_name)} = $1 WHERE id = $2`,
      [value, subjectId],
    );
    columnsErased.push(field.column_name);
  }

  return { columnsErased, columnsRetained };
}
