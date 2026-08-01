-- S-10 (REQ-006, "should"): lightweight warm-relationship edges. Ali is
-- explicit: no graph database, no complex traversal. Two node kinds only —
-- users and clients — reusing entities that already have real ids rather
-- than inventing a new "contacts" table (see 06_decisions/017).
CREATE TABLE IF NOT EXISTS relationship_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_type TEXT NOT NULL CHECK (from_type IN ('user', 'client')),
  from_id UUID NOT NULL,
  to_type TEXT NOT NULL CHECK (to_type IN ('user', 'client')),
  to_id UUID NOT NULL,
  -- Open vocabulary, not a hard enum: scoring only ever reads `strength`
  -- (below), never this label, so it doesn't need to be exhaustive the way
  -- sales_pipeline.status does.
  relationship_type TEXT NOT NULL,
  -- Deliberately two-level, not a precise float a human can't defend — same
  -- reasoning as MATCH_CONFIG's saturation cap (06_decisions/011).
  strength TEXT NOT NULL CHECK (strength IN ('strong', 'weak')),
  -- Free text ("worked together at X, 2019-2021") can name a third party —
  -- PII-flagged below, redacted from display like contact_info.
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Undirected: a 'colleague' edge has no meaningful direction, and even
-- 'knows_contact' (user->client) is queried from the client side regardless
-- of insertion order. Query helpers check both (from_id) and (to_id) rather
-- than doubling every symmetric relationship into two rows.
CREATE INDEX IF NOT EXISTS relationship_edges_from_idx ON relationship_edges (from_type, from_id);
CREATE INDEX IF NOT EXISTS relationship_edges_to_idx ON relationship_edges (to_type, to_id);

-- Mutable confirm/dismiss state — NOT an append-only audit table like
-- sales_pipeline_audit or opportunity_package_release_audit. This story only
-- asks for a recorded state distinction ("only confirmed paths count"), not
-- an accountability trail, so it gets ordinary UPDATE-in-place semantics
-- (06_decisions/018). Unlike S-09's release, a decision is never terminal: a
-- rep can change a confirm to a dismiss or back, because this only gates an
-- internal signal-quality flag, not anything leaving the platform.
CREATE TABLE IF NOT EXISTS relationship_path_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  -- The path's identity. MUST be written sorted (canonical order), never
  -- traversal order — a path is the same real-world path regardless of
  -- which order its edges happen to come back from a query, so matching on
  -- traversal order would let a confirmed path silently read back as
  -- unconfirmed, or let a re-confirm violate/duplicate past the UNIQUE
  -- constraint below instead of updating the existing row. Both routes
  -- canonicalize through one shared helper (canonicalEdgeIds in
  -- pathConfidence.ts) before this column is ever read or written.
  edge_ids UUID[] NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'dismissed')),
  -- The JWT sub, not a FK — same reasoning as every other actor column in
  -- this schema (sales_pipeline_audit.changed_by, opportunity_packages.released_by).
  decided_by TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One decision row per distinct path per opportunity — correct specifically
-- because edge_ids is always canonicalized before it reaches this
-- constraint. A repeat POST upserts (ON CONFLICT ... DO UPDATE), which is
-- also how a rep changes their mind.
CREATE UNIQUE INDEX IF NOT EXISTS relationship_path_decisions_unique_path
  ON relationship_path_decisions (opportunity_id, edge_ids);

-- PII registry (06_decisions/009, /017):
--   1. relationship_edges.notes can name a third party in free text — same
--      conservative redact_from_display treatment as contact_info, though
--      (honestly noted in 017) erasure can only blank the whole note, not
--      strip a single mentioned name out of free text.
--   2. relationship_path_decisions.decided_by identifies a staff member, but
--      this table is NOT an append-only audit trail (no DB trigger enforces
--      it), so it gets the SAME reset_to_empty treatment as any other
--      identity column — deliberately NOT retain_exempt, which is reserved
--      for the audit-exemption carve-out sales_pipeline_audit/
--      opportunity_package_release_audit use (06_decisions/013).
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('relationship_edges', 'notes', 'identity', 'reset_to_empty', true),
  ('relationship_path_decisions', 'decided_by', 'identity', 'reset_to_empty', false)
ON CONFLICT DO NOTHING;
