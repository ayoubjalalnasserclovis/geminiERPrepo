-- ============================================================================
-- Transferts Propria — tracking "qui doit quoi" (même logique que caisse)
-- ============================================================================
-- Ajoute :
--   - collect_responsible_id : collaborateur en charge de récupérer le cash
--     auprès du chauffeur (jamais un client)
--   - collected_at : date de collecte effective
--   - remitted_confirmed_by : qui (le CEO) a confirmé la remise
-- ============================================================================

ALTER TABLE propria_transfers
  ADD COLUMN IF NOT EXISTS collect_responsible_id UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS collected_at DATE,
  ADD COLUMN IF NOT EXISTS remitted_confirmed_by UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS propria_transfers_collect_responsible_idx
  ON propria_transfers (collect_responsible_id)
  WHERE collect_responsible_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS propria_transfers_dues_idx
  ON propria_transfers (cash_collected, cash_remitted_at);

COMMENT ON COLUMN propria_transfers.collect_responsible_id IS
  'Collaborateur en charge de récupérer le cash auprès du chauffeur. Permet de tracker qui doit remettre quoi au CEO.';
COMMENT ON COLUMN propria_transfers.collected_at IS
  'Date à laquelle le cash a été effectivement collecté.';
COMMENT ON COLUMN propria_transfers.remitted_confirmed_by IS
  'Profil CEO ayant confirmé la remise du cash. cash_remitted_at est la date.';
