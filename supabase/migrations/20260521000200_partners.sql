-- ============================================================================
-- 02 — Partners & partner_agents
-- ============================================================================

CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  quartiers_covered TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','inactif','prospect')),
  contract_signed BOOLEAN NOT NULL DEFAULT false,
  contract_date DATE,
  last_contact_at DATE,
  has_whatsapp_group BOOLEAN NOT NULL DEFAULT false,
  evaluation INTEGER CHECK (evaluation BETWEEN 1 AND 3),
  notes TEXT,
  assigned_to UUID REFERENCES profiles(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX partners_status_idx ON partners (status) WHERE deleted_at IS NULL;
CREATE INDEX partners_assigned_idx ON partners (assigned_to) WHERE deleted_at IS NULL;

CREATE TRIGGER partners_set_updated_at BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE partner_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  is_primary_contact BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  started_at DATE,
  ended_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX partner_agents_partner_idx ON partner_agents (partner_id) WHERE ended_at IS NULL;
