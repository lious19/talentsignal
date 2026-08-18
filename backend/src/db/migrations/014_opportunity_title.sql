-- HF-3 needs to know the ROLE a hard-to-fill opportunity is for, so it can
-- rank students against that role's skills. Migrations 003/013 stored the
-- company and the scores, but never the signal's title. Add it.
--
-- Same backfill-then-drop-default discipline as 005/013: existing rows predate
-- this and have no title to recover, so they backfill to '' (empty), then the
-- default is dropped so every future upsert (upsertBatch in hiddenDemand.ts)
-- must supply the title explicitly rather than silently storing ''.
ALTER TABLE opportunities ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunities ALTER COLUMN title DROP DEFAULT;
