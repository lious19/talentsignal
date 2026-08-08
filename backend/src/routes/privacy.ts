import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import {
  SUBJECT_TABLE_BY_TYPE,
  applyErasure,
  collectAccessPayload,
  loadPiiFields,
  type PrivacySubjectType,
} from "../privacy/piiRegistry";

// Staff-initiated, on behalf of the candidate/client who asked — there is no
// candidate-facing login anywhere in this app (S-15's own scope note).
const PRIVACY_ROLES = ["admin", "recruiter"];

interface PrivacyRequestRow {
  id: string;
  subject_type: PrivacySubjectType;
  subject_id: string;
  request_type: "access" | "erasure";
  status: "submitted" | "queued" | "actioned";
  requested_by: string;
  created_at: string;
  updated_at: string;
}

function toPrivacyRequestResponse(row: PrivacyRequestRow) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    requestType: row.request_type,
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isValidSubjectType(value: unknown): value is PrivacySubjectType {
  return value === "candidate" || value === "client";
}

function isValidRequestType(value: unknown): value is "access" | "erasure" {
  return value === "access" || value === "erasure";
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// piiRegistry.ts returns access-request values keyed by the raw DB column
// name (snake_case, since it loops an arbitrary registry) — converted here,
// at the response boundary, to match every other endpoint's camelCase wire
// format. Generic (works for any registered column name), not a lookup
// table, so it stays correct as columns are added.
function toCamelCase(columnName: string): string {
  return columnName.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function toCamelCaseKeys(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    result[toCamelCase(key)] = value;
  }
  return result;
}

async function recordAuditStep(
  client: PoolClient,
  requestId: string,
  step: "submitted" | "queued" | "actioned",
  actor: string,
  detail: Record<string, unknown> | null,
): Promise<void> {
  await client.query(
    `INSERT INTO privacy_audit_log (request_id, step, actor, detail) VALUES ($1, $2, $3, $4)`,
    [requestId, step, actor, detail ? JSON.stringify(detail) : null],
  );
}

export function privacyRouter(pool: Pool): Router {
  const router = Router();

  // One transaction walks submitted -> queued -> actioned in a single
  // request/response cycle — there's no queue/worker infrastructure
  // anywhere in this stack, and nothing in the acceptance criteria asks
  // for asynchronous processing, so "queued" is a real, recorded status
  // transition, not a literal background job.
  router.post("/privacy/request", requireAuth, requireRole(PRIVACY_ROLES), async (req, res) => {
    const subjectType = req.body?.subjectType;
    const subjectId = req.body?.subjectId;
    const requestType = req.body?.requestType;

    if (!isValidSubjectType(subjectType)) {
      res.status(400).json({ error: "subjectType must be 'candidate' or 'client'" });
      return;
    }
    if (!isValidId(subjectId)) {
      res.status(400).json({ error: "subjectId is required" });
      return;
    }
    if (!isValidRequestType(requestType)) {
      res.status(400).json({ error: "requestType must be 'access' or 'erasure'" });
      return;
    }

    const tableName = SUBJECT_TABLE_BY_TYPE[subjectType];
    const requestedBy = req.user!.id;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const subjectResult = await client.query(`SELECT id FROM ${tableName} WHERE id = $1`, [
        subjectId,
      ]);
      if (subjectResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: `${subjectType} not found` });
        return;
      }

      const { rows: submittedRows } = await client.query<PrivacyRequestRow>(
        `INSERT INTO privacy_requests (subject_type, subject_id, request_type, status, requested_by)
         VALUES ($1, $2, $3, 'submitted', $4) RETURNING *`,
        [subjectType, subjectId, requestType, requestedBy],
      );
      const requestId = submittedRows[0].id;
      await recordAuditStep(client, requestId, "submitted", requestedBy, {
        subjectType,
        requestType,
      });

      await client.query(
        `UPDATE privacy_requests SET status = 'queued', updated_at = now() WHERE id = $1`,
        [requestId],
      );
      await recordAuditStep(client, requestId, "queued", requestedBy, null);

      const fields = await loadPiiFields(client, tableName);

      let result: unknown;
      let actionedDetail: Record<string, unknown>;
      if (requestType === "access") {
        const payload = await collectAccessPayload(client, tableName, subjectId, fields);
        result = toCamelCaseKeys(payload.values);
        actionedDetail = { columnsReturned: fields.map((field) => field.column_name) };
      } else {
        const summary = await applyErasure(client, tableName, subjectId, fields);
        result = summary;
        actionedDetail = summary as unknown as Record<string, unknown>;
      }

      const { rows: actionedRows } = await client.query<PrivacyRequestRow>(
        `UPDATE privacy_requests SET status = 'actioned', updated_at = now() WHERE id = $1 RETURNING *`,
        [requestId],
      );
      await recordAuditStep(client, requestId, "actioned", requestedBy, actionedDetail);

      await client.query("COMMIT");

      logger.info(
        { correlationId: req.correlationId, requestId, subjectType, requestType },
        "privacy request actioned",
      );
      res.status(201).json({ request: toPrivacyRequestResponse(actionedRows[0]), result });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection may already be unusable — the outer error is what matters.
      }
      logger.error({ correlationId: req.correlationId, err }, "privacy request failed");
      res.status(500).json({ error: "privacy request failed" });
    } finally {
      client.release();
    }
  });

  router.get("/privacy/requests", requireAuth, requireRole(PRIVACY_ROLES), async (req, res) => {
    try {
      const { rows } = await pool.query<PrivacyRequestRow>(
        "SELECT * FROM privacy_requests ORDER BY created_at DESC",
      );
      res.status(200).json({ requests: rows.map(toPrivacyRequestResponse) });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list privacy requests failed");
      res.status(500).json({ error: "failed to list privacy requests" });
    }
  });

  return router;
}
