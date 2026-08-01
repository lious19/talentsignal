-- S-09 (REQ-005, REQ-020): AI-drafted opportunity packages under human release.
-- Two tables, same split as 006's sales_pipeline / sales_pipeline_audit: a
-- mutable current-state row (fast reads for the review screen) plus an
-- append-only history row (the tamper-evident record S-15 reads). See
-- 06_decisions/015 for why a package requires BOTH opportunity_id and
-- job_opening_id — opportunities (market signals) and job_openings (platform
-- data) have no existing FK relating them, so the draft request supplies
-- both explicitly rather than inventing a link that doesn't reflect how
-- these two agents actually produce data.
CREATE TABLE IF NOT EXISTS opportunity_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  job_opening_id UUID NOT NULL REFERENCES job_openings(id),
  candidate_ids UUID[] NOT NULL,
  -- The heuristic-composed proposal (composePackage.ts) — company, opportunity
  -- rationale, and ranked candidates with fit scores. Never free text from an
  -- LLM; see 06_decisions/016 for the top-N candidate count it embeds.
  content JSONB NOT NULL,
  -- Stored explicitly, not just implied by "there's no other path yet" — the
  -- story requires a data flag AND a UI label, not one standing in for the
  -- other.
  ai_generated BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released')),
  -- The JWT sub, not a FK to users(id) — same reasoning as
  -- sales_pipeline_audit.changed_by (006): survives a deleted user account,
  -- and test fixtures sign non-UUID subs. NULL until release.
  released_by TEXT,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_packages_status_idx ON opportunity_packages (status);

CREATE TABLE IF NOT EXISTS opportunity_package_release_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES opportunity_packages(id),
  opportunity_id UUID NOT NULL,
  released_by TEXT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS opportunity_package_release_audit_package_id_idx
  ON opportunity_package_release_audit (package_id);

-- Append-only enforcement (06_decisions/013's reasoning applies verbatim: the
-- single Postgres role in this deployment is both superuser and table owner,
-- so REVOKE-based enforcement would be a silent no-op — a trigger fires
-- unconditionally regardless of role). A dedicated function per table,
-- matching 006's convention rather than generalizing one trigger function
-- across both audit tables.
CREATE OR REPLACE FUNCTION opportunity_package_release_audit_no_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'opportunity_package_release_audit is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER opportunity_package_release_audit_append_only
  BEFORE UPDATE OR DELETE ON opportunity_package_release_audit
  FOR EACH STATEMENT
  EXECUTE FUNCTION opportunity_package_release_audit_no_mutation();

-- PII registry (06_decisions/009, /013, /015):
--   1. content embeds candidate `name` (identity PII, already flagged on
--      candidates.name) but never contact_info — same "ranking/composition
--      surfaces name, not contact info" discipline clientMatchmaking.ts
--      already follows. reset_to_empty for now; see 06_decisions/015 for the
--      open question of whether a RELEASED package's content should instead
--      be retained as a record of a human decision, deferred to S-15/Ali.
--   2. opportunity_package_release_audit.released_by is the direct analog of
--      sales_pipeline_audit.changed_by (013): a staff-member identifier
--      inside an append-only audit trail, exempt from erasure for the same
--      reason (erasing who-did-what-when defeats the purpose of the log).
--      Leaving this unregistered is exactly the gap 009 warns about — S-15's
--      generic pii_fields-driven erasure loop would either miss this column
--      or, worse, hit the append-only trigger and throw.
--   3. opportunity_packages.released_by carries the same identifier for fast
--      reads. Same retain_exempt treatment as the audit row it mirrors — a
--      reset_to_empty here while the audit row retains it would just make
--      the fast-read copy silently drift from the source of truth.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('opportunity_packages', 'content', 'identity', 'reset_to_empty', false),
  ('opportunity_package_release_audit', 'released_by', 'identity', 'retain_exempt', false),
  ('opportunity_packages', 'released_by', 'identity', 'retain_exempt', false)
ON CONFLICT DO NOTHING;
