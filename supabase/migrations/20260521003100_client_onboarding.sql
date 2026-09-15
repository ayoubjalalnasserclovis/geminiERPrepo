-- ============================================================================
-- Onboarding obligatoire côté client : champs additionnels + flag de complétion
-- ============================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS expected_rent NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS expected_gross_yield_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS expected_net_yield_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.expected_rent IS 'Loyer mensuel attendu (EUR) — saisi par le client à l''onboarding';
COMMENT ON COLUMN clients.expected_gross_yield_pct IS 'Rendement brut espéré par le client (%)';
COMMENT ON COLUMN clients.expected_net_yield_pct IS 'Rendement net espéré par le client (%)';
COMMENT ON COLUMN clients.onboarding_completed_at IS 'Date de complétion de l''onboarding portail — bloque l''accès si NULL';

-- ─── RLS : autoriser le client à mettre à jour SON profil ──────────────
DROP POLICY IF EXISTS clients_self_update ON clients;
CREATE POLICY clients_self_update ON clients FOR UPDATE
  USING (profile_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (profile_id = auth.uid() AND deleted_at IS NULL);
