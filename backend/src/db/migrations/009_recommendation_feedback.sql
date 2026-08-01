-- S-11 (REQ-008, "should"): the recommendation engine reuses S-06's
-- scoreCandidate() unchanged (see recommendationEngine.ts) — this migration
-- only adds the genuinely new part, the feedback loop. "Bank the signal now,
-- tune later" (Ali's words): nothing reads this table to change a ranking
-- yet.
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES job_openings(id),
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  -- The JWT sub, not a FK — same reasoning as every other actor column in
  -- this schema (sales_pipeline_audit.changed_by, opportunity_packages.released_by,
  -- relationship_path_decisions.decided_by).
  recruiter_id TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('good', 'bad')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recommendations are computed on the fly (no persisted recommendation row),
-- so this is the keying the story itself specifies: one feedback mark per
-- recruiter, per candidate, per job. A repeat POST upserts (ON CONFLICT ...
-- DO UPDATE), which is also how a recruiter reverses good<->bad — plain
-- mutable state, reversible, like relationship_path_decisions (S-10), NOT
-- append-only like sales_pipeline_audit/opportunity_package_release_audit.
--
-- Known, open limitation (06_decisions/019): this upsert keeps only the
-- LATEST mark, not the history of how it changed. TBI's "check for and
-- correct bias OVER TIME" language may eventually want the full event
-- stream, not just the current opinion. Deliberately not built here — an
-- append-only recommendation_feedback_events table alongside this one would
-- be the additive fix if Ali confirms it's needed, not a redesign.
CREATE UNIQUE INDEX IF NOT EXISTS recommendation_feedback_unique_mark
  ON recommendation_feedback (job_id, candidate_id, recruiter_id);

-- PII registry (06_decisions/009, /018): recruiter_id identifies a staff
-- member, but this table is NOT an append-only audit trail (no DB trigger
-- enforces it), so it gets the same reset_to_empty treatment as
-- relationship_path_decisions.decided_by — deliberately NOT retain_exempt,
-- which stays reserved for the audit-exemption carve-out 06_decisions/013
-- defined for sales_pipeline_audit/opportunity_package_release_audit.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('recommendation_feedback', 'recruiter_id', 'identity', 'reset_to_empty', false)
ON CONFLICT DO NOTHING;
