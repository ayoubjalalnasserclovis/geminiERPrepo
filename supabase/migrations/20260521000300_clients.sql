-- ============================================================================
-- 03 — Clients
-- ============================================================================

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  nationality TEXT,
  budget_min NUMERIC(14,2),
  budget_max NUMERIC(14,2),
  available_savings NUMERIC(14,2),
  credit_type TEXT CHECK (credit_type IN ('yes','no','islamic')),
  has_procuration BOOLEAN NOT NULL DEFAULT false,
  procuration_received BOOLEAN NOT NULL DEFAULT false,
  signature_mode TEXT CHECK (signature_mode IN ('distance','presentiel')),
  location_preferences TEXT[] DEFAULT '{}',
  property_type_preferences TEXT[] DEFAULT '{}',
  specificities TEXT,
  comments TEXT,
  consent_at TIMESTAMPTZ,
  consent_version TEXT,
  data_retention_until DATE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);

CREATE UNIQUE INDEX clients_email_lower_idx
  ON clients (LOWER(email))
  WHERE deleted_at IS NULL;

CREATE INDEX clients_profile_idx ON clients (profile_id) WHERE deleted_at IS NULL;

CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
