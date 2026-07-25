CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  experience INTEGER,
  availability TEXT,
  contact_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  description TEXT,
  requirements TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schema-level PII registry (06_decisions/009). Two independent facts per
-- column, not one boolean: erasure_strategy is what S-15's erasure path
-- executes; redact_from_display is what this story's own stripPii() reads
-- right now. contact_info and name both need erasing on request, but only
-- contact_info needs hiding from non-recruiter/admin roles today — name
-- stays visible so S-06's matchmaking read path keeps working.
--
-- clients.name is deliberately absent: it's a client *company* name, not
-- personal data — any person it might reveal is already covered by
-- clients.contact_info.
--
-- Both NOT NULL columns below rule out a literal "set to SQL NULL" erasure
-- strategy, hence reset_to_empty (contact_info -> '{}'::jsonb) and anonymize
-- (name -> a placeholder) instead of a single null_column strategy.
CREATE TABLE IF NOT EXISTS pii_fields (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  category TEXT NOT NULL,
  erasure_strategy TEXT NOT NULL,
  redact_from_display BOOLEAN NOT NULL,
  PRIMARY KEY (table_name, column_name)
);

INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('clients',    'contact_info', 'contact',  'reset_to_empty', true),
  ('candidates', 'contact_info', 'contact',  'reset_to_empty', true),
  ('candidates', 'name',         'identity', 'anonymize',      false)
ON CONFLICT DO NOTHING;
