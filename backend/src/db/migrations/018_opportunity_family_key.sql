-- S-23: role-family taxonomy for a measured (not just curated) roleScarcity
-- basis. family_key is a derived property of a posting's title
-- (classifyFamily() in hardToFillScore.ts), so it lives on opportunities,
-- not raw_requisitions — raw_requisitions stays append-only source-of-truth
-- per decision 041, no derived fields belong there.
--
-- Nullable, no default, on purpose: unlike 013/014's simple constant
-- backfills, family_key's correct value is data-dependent (computed per row
-- from title via classifyFamily), which SQL alone can't express. A separate
-- one-off script (scripts/backfillFamilyKey.ts) fills every existing row
-- right after this migration runs. This column intentionally stays nullable
-- and undropped-default until S-23 Step 3 wires classifyFamily() into the
-- ingestion write path (upsertBatch in hiddenDemand.ts) — only once every
-- new row is guaranteed a real value at insert time does NOT NULL become
-- safe, mirroring 013/014's backfill-then-drop-default discipline but split
-- across two steps here because the fill itself needs application code.
ALTER TABLE opportunities ADD COLUMN family_key TEXT;

CREATE INDEX IF NOT EXISTS opportunities_family_key_idx ON opportunities (family_key);
