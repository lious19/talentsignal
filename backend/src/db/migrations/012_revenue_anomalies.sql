-- S-17 (REQ-016/REQ-015): revenue anomaly detection + client segmentation.
-- Segmentation needs no new table — it's computed on the fly from the
-- existing job_openings/clients FK, same "no snapshot table" reasoning as
-- 06_decisions/020. The anomaly detector's human-tuning loop DOES need
-- state: same mutable-current-state + append-only-trail split as every
-- other guarded workflow in this schema (sales_pipeline/_audit,
-- privacy_requests/_audit, crm_writes/_audit).
--
-- One row per metric (today, only 'placements_per_month' — the named
-- revenue proxy, 06_decisions/025) holding the CURRENT, mutable kStdDev.
-- This is the entire "threshold learns" mechanism: one number, moved by a
-- fixed step, on one explicit human action (suppress), never auto-decayed.
CREATE TABLE IF NOT EXISTS anomaly_thresholds (
  metric TEXT PRIMARY KEY,
  k_std_dev NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only record of every human confirm/suppress decision. No
-- "flagged" event is ever written here — GET /api/analytics/anomalies is a
-- read-only, side-effect-free query, same discipline as every other GET in
-- this codebase.
CREATE TABLE IF NOT EXISTS anomaly_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric TEXT NOT NULL,
  month TEXT NOT NULL,
  step TEXT NOT NULL CHECK (step IN ('confirmed', 'suppressed')),
  actor TEXT NOT NULL,
  detail JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anomaly_audit_metric_month_idx ON anomaly_audit (metric, month);

-- Append-only enforcement (06_decisions/013's reasoning applies verbatim).
-- Dedicated function per table, matching the sales_pipeline_audit /
-- privacy_audit_log / crm_write_audit convention rather than generalizing
-- one trigger function across all of them.
CREATE OR REPLACE FUNCTION anomaly_audit_no_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'anomaly_audit is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anomaly_audit_append_only
  BEFORE UPDATE OR DELETE ON anomaly_audit
  FOR EACH STATEMENT
  EXECUTE FUNCTION anomaly_audit_no_mutation();

-- actor identifies a staff member — personal data under decision 009's own
-- standard, registered retain_exempt exactly like sales_pipeline_audit.changed_by,
-- opportunity_package*.released_by, and privacy_audit_log/crm_write_audit.actor.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('anomaly_audit', 'actor', 'identity', 'retain_exempt', false)
ON CONFLICT DO NOTHING;
