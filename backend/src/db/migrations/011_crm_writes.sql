-- S-16 (REQ-014): CRM pollution prevention — the safe-write machinery on
-- writes to client records. There is no real external CRM in this demo
-- (providers are mocked elsewhere in this app); "CRM write" means a
-- guarded, idempotency-key-protected, reversible write to clients.name/
-- clients.contact_info. Same split as every other workflow in this schema:
-- crm_writes is mutable current-state (one row per idempotency key),
-- crm_write_audit is the append-only trail of what happened to it.
CREATE TABLE IF NOT EXISTS crm_writes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Globally unique, not scoped per-client — the standard idempotency-key
  -- contract: a key identifies one logical write attempt, full stop. The
  -- UNIQUE constraint is what makes claiming a key via
  -- "INSERT ... ON CONFLICT DO NOTHING" atomic and race-safe (the same
  -- discipline auth.ts's isUniqueViolation/23505 handling reacts to, used
  -- here proactively instead).
  idempotency_key TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES clients(id),
  -- The prior-known-good snapshot ({name, contact_info}) captured at write
  -- time — what a rollback restores. Filled before COMMIT; NULL only for
  -- the instant between claiming the key and finishing the write, which no
  -- other transaction can ever observe.
  before_image JSONB,
  after_image JSONB,
  status TEXT NOT NULL CHECK (status IN ('applied', 'rolled_back')) DEFAULT 'applied',
  -- The JWT sub, not a FK — same reasoning as every other actor column in
  -- this schema (sales_pipeline_audit.changed_by, opportunity_packages.released_by,
  -- privacy_requests.requested_by).
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_writes_client_id_idx ON crm_writes (client_id);

CREATE TABLE IF NOT EXISTS crm_write_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  write_id UUID NOT NULL REFERENCES crm_writes(id),
  -- Deliberately no submitted/queued phases the way S-15's privacy workflow
  -- has them (06_decisions/023) — S-16's Gherkin only asks that a write and
  -- a rollback are recorded, not a multi-step request lifecycle. 'deduped'
  -- is recorded too, even though nothing in `clients` changes on that path,
  -- so dedupe activity is itself visible, not silent.
  step TEXT NOT NULL CHECK (step IN ('applied', 'deduped', 'rolled_back')),
  actor TEXT NOT NULL,
  detail JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_write_audit_write_id_idx ON crm_write_audit (write_id);

-- Append-only enforcement (06_decisions/013's reasoning applies verbatim —
-- this deployment's single Postgres role is both superuser and table
-- owner, so REVOKE would be silently inert; a trigger fires unconditionally
-- regardless of role). Dedicated function per table, matching the
-- sales_pipeline_audit / opportunity_package_release_audit / privacy_audit_log
-- convention rather than generalizing one trigger function across all four.
CREATE OR REPLACE FUNCTION crm_write_audit_no_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'crm_write_audit is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_write_audit_append_only
  BEFORE UPDATE OR DELETE ON crm_write_audit
  FOR EACH STATEMENT
  EXECUTE FUNCTION crm_write_audit_no_mutation();

-- requested_by/actor identify a staff member — personal data under decision
-- 009's own standard, registered retain_exempt exactly like
-- sales_pipeline_audit.changed_by / privacy_requests.requested_by.
--
-- crm_writes.before_image/after_image are DELIBERATELY NOT registered here,
-- and NOT retain_exempt (06_decisions/024, still an OPEN question for Ali,
-- not resolved as an exemption): they contain a full copy of a client's
-- name/contact_info at write time. Registering them retain_exempt would
-- mis-apply the audit-trail carve-out — an audit log is a legal record of
-- what happened (rightly exempt), but a rollback snapshot is an
-- operational undo buffer, and marking it exempt would let a rollback
-- RESURRECT contact info a client legally erased via S-15. Leaving them
-- unregistered means today's pii_fields-driven erasure loop simply doesn't
-- reach them (the same "embedded copies" limitation decision 023 already
-- names for opportunity_packages.content) — a documented gap, not a
-- silently-built exemption. See 06_decisions/024 for the full reasoning;
-- Ali's ruling may require code changes here, not just a registry update.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('crm_writes', 'requested_by', 'identity', 'retain_exempt', false),
  ('crm_write_audit', 'actor', 'identity', 'retain_exempt', false)
ON CONFLICT DO NOTHING;
