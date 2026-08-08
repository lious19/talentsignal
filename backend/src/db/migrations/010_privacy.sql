-- S-15 (REQ-012, REQ-013): the privacy-request workflow. Two tables, same
-- split every other workflow in this schema uses: privacy_requests is
-- mutable current-state (submitted -> queued -> actioned), privacy_audit_log
-- is the append-only trail of how it got there. This is the general
-- privacy-event audit the story asks for, not a system-wide audit log for
-- every action in the app.
CREATE TABLE IF NOT EXISTS privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('candidate', 'client')),
  subject_id UUID NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'erasure')),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'queued', 'actioned')) DEFAULT 'submitted',
  -- The JWT sub, not a FK — same reasoning as every other actor column in
  -- this schema (sales_pipeline_audit.changed_by, opportunity_packages.released_by,
  -- recommendation_feedback.recruiter_id). There's no candidate-facing login
  -- in this app, so this is always a staff member (admin/recruiter) acting
  -- on behalf of the candidate/client who asked.
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privacy_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES privacy_requests(id),
  step TEXT NOT NULL CHECK (step IN ('submitted', 'queued', 'actioned')),
  actor TEXT NOT NULL,
  -- Column NAMES only (e.g. {"columnsErased": ["contact_info"]}), never the
  -- PII values themselves — an audit log holding raw values would become a
  -- second, harder-to-govern copy of the data it's supposed to be
  -- governing. The actual access-request payload goes only in the HTTP
  -- response to the authenticated caller, never persisted here.
  detail JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_audit_log_request_id_idx ON privacy_audit_log (request_id);

-- Append-only enforcement (06_decisions/013's reasoning applies verbatim —
-- this deployment's single Postgres role is both superuser and table owner,
-- so REVOKE would be silently inert; a trigger fires unconditionally
-- regardless of role). Dedicated function per table, matching the
-- sales_pipeline_audit / opportunity_package_release_audit convention
-- rather than generalizing one trigger function across all three.
CREATE OR REPLACE FUNCTION privacy_audit_log_no_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'privacy_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER privacy_audit_log_append_only
  BEFORE UPDATE OR DELETE ON privacy_audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION privacy_audit_log_no_mutation();

-- Consent flag (06_decisions/023) — candidates only, not clients: clients.
-- contact_info is a business's contact person, and extending consent
-- semantics to B2B contact data is a separate, unscoped judgment call.
--
-- DEFAULT true is a documented pragmatic exception, NOT the GDPR-faithful
-- posture. The correct production default is opt-in (false), paired with an
-- actual consent-collection step upstream of candidate creation — neither
-- exists in this product today (CandidatesScreen has no "did they consent"
-- field). Defaulting to false here wouldn't reflect any real consent
-- failure; it would just make every existing candidate's contact info
-- silently vanish. The demonstrable trust scenario is the REVOKE path: flip
-- an existing candidate to false and contactInfo disappears from every
-- response, flip back and it reappears — that proves consent gates use,
-- independent of what the default happens to be. See 06_decisions/023.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_given BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ;
-- consent_given/consent_recorded_at are deliberately NOT registered in
-- pii_fields: they're metadata about permission state, not identifying data
-- themselves, so the erasure loop below leaves them untouched by omission —
-- the record of when consent last changed survives an erasure request, the
-- same practical effect as retain_exempt without needing a new registry
-- value for a column that isn't really "PII" in the same sense name/contact
-- info are.

-- requested_by/actor identify a staff member — personal data under decision
-- 009's own standard, registered retain_exempt exactly like
-- sales_pipeline_audit.changed_by and opportunity_package*.released_by. Not
-- required by pii.registryCoverage.test.ts's column-name regex (it doesn't
-- match "actor"/"requested_by" either — neither did changed_by/released_by),
-- registered anyway for genuine compliance completeness, not just to pass a
-- test.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('privacy_requests', 'requested_by', 'identity', 'retain_exempt', false),
  ('privacy_audit_log', 'actor', 'identity', 'retain_exempt', false)
ON CONFLICT DO NOTHING;
