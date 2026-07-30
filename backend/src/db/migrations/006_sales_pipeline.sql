CREATE TABLE IF NOT EXISTS sales_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL CHECK (status IN ('prospecting', 'contacted', 'negotiation', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One active pipeline row per client. This table is mutated in place as a
  -- client moves stages — it is NOT append-only; only its audit trail below is.
  UNIQUE (client_id)
);

CREATE TABLE IF NOT EXISTS sales_pipeline_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- client_id, not pipeline_id: sales_pipeline's UNIQUE(client_id) makes the
  -- two equivalent for lookup (at most one pipeline row per client, ever), so
  -- a second FK column would be redundant, not additive.
  client_id UUID NOT NULL REFERENCES clients(id),
  -- The JWT sub / req.user.id. Deliberately NOT a FK to users(id): test
  -- fixtures sign fake non-UUID subs, and semantically an audit trail should
  -- survive a user account being deleted later, not cascade-block or dangle.
  changed_by TEXT NOT NULL,
  -- NULL means "first-ever stage assignment for this client" — no prior stage.
  from_stage TEXT CHECK (from_stage IN ('prospecting', 'contacted', 'negotiation', 'closed')),
  to_stage TEXT NOT NULL CHECK (to_stage IN ('prospecting', 'contacted', 'negotiation', 'closed')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_pipeline_audit_client_id_idx ON sales_pipeline_audit (client_id);

-- Append-only enforcement (06_decisions/013). This deployment has exactly one
-- Postgres role (POSTGRES_USER), which is both a superuser and this table's
-- owner (this migration runs as that role) — REVOKE-based enforcement would
-- be a silent no-op against it, since superusers bypass every ACL check and
-- owners are exempt from ordinary GRANT/REVOKE restrictions on their own
-- objects. A trigger fires unconditionally for any role, superuser included.
CREATE OR REPLACE FUNCTION sales_pipeline_audit_no_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'sales_pipeline_audit is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_pipeline_audit_append_only
  BEFORE UPDATE OR DELETE ON sales_pipeline_audit
  FOR EACH STATEMENT
  EXECUTE FUNCTION sales_pipeline_audit_no_mutation();

-- changed_by identifies a staff member, so it's personal data under
-- GDPR/CCPA (06_decisions/009's own standard: an identifier is PII even when
-- it must stay visible/retained). But an audit trail is a standard,
-- well-established exemption from erasure (e.g. GDPR Art. 17(3)) — erasing
-- who-did-what-when would defeat the purpose of keeping the log at all.
-- retain_exempt is a new erasure_strategy value (009 only defined
-- reset_to_empty/anonymize) so S-15's generic pii_fields loop finds this
-- column, recognizes it as PII, and already knows it must be retained, not
-- erased — see 06_decisions/013.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('sales_pipeline_audit', 'changed_by', 'identity', 'retain_exempt', false)
ON CONFLICT DO NOTHING;
