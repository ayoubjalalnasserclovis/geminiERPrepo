-- ============================================================================
-- Onboarding client V2 : structure d'investissement, co-investisseurs,
-- adresse de facturation.
--
-- Règle métier : tant que `onboarding_completed_at` est NULL, le client est
-- bloqué sur /client/onboarding (gate déjà en place dans (client)/layout.tsx).
-- L'action `completeOnboardingAction` n'affecte ce flag QUE si toutes les
-- pièces d'identité (client + chaque co-investisseur) ont été uploadées.
-- ============================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS investment_holding TEXT
    CHECK (investment_holding IN ('nom_propre','societe')),
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS company_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS investment_party_count INTEGER
    CHECK (investment_party_count IS NULL OR investment_party_count >= 1),
  ADD COLUMN IF NOT EXISTS billing_address_line TEXT,
  ADD COLUMN IF NOT EXISTS billing_city TEXT,
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS billing_country TEXT;

COMMENT ON COLUMN clients.investment_holding IS
  'Mode de détention : en nom propre (personne physique) ou via société';
COMMENT ON COLUMN clients.company_name IS
  'Raison sociale (uniquement si investment_holding = societe)';
COMMENT ON COLUMN clients.company_registration_number IS
  'N° RC / SIREN / Kbis selon pays (uniquement si societe)';
COMMENT ON COLUMN clients.investment_party_count IS
  'Nombre total d''investisseurs (vous compris). 1 = seul, ≥2 = à plusieurs';
COMMENT ON COLUMN clients.billing_address_line IS 'Adresse de facturation — rue + n°';
COMMENT ON COLUMN clients.billing_city IS 'Ville de facturation';
COMMENT ON COLUMN clients.billing_postal_code IS 'Code postal de facturation';
COMMENT ON COLUMN clients.billing_country IS 'Pays de facturation';

-- ─── Co-investisseurs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_co_investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  relation TEXT, -- ex: conjoint, associé, parent...
  piece_identite_path TEXT NOT NULL,
  piece_identite_size_bytes INTEGER,
  piece_identite_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_co_investors_client_idx
  ON client_co_investors(client_id);

COMMENT ON TABLE client_co_investors IS
  'Co-investisseurs liés à un client principal. Chaque ligne contient la pièce d''identité d''une personne additionnelle qui investit avec le client.';

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE client_co_investors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS co_investors_staff_all ON client_co_investors;
CREATE POLICY co_investors_staff_all ON client_co_investors
  FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

DROP POLICY IF EXISTS co_investors_self_select ON client_co_investors;
CREATE POLICY co_investors_self_select ON client_co_investors
  FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid()));

DROP POLICY IF EXISTS co_investors_self_insert ON client_co_investors;
CREATE POLICY co_investors_self_insert ON client_co_investors
  FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid()));

DROP POLICY IF EXISTS co_investors_self_delete ON client_co_investors;
CREATE POLICY co_investors_self_delete ON client_co_investors
  FOR DELETE
  USING (client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid()));
