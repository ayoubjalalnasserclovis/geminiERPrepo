-- Onboarding client : champ optionnel "besoin ouverture compte bancaire au Maroc"
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS needs_bank_account_opening BOOLEAN,
  ADD COLUMN IF NOT EXISTS bank_account_notes TEXT;

COMMENT ON COLUMN clients.needs_bank_account_opening IS
  'Le client a-t-il besoin que Stoniz l''accompagne pour l''ouverture d''un compte bancaire au Maroc (necessaire pour percevoir les loyers MAD) ?';
COMMENT ON COLUMN clients.bank_account_notes IS
  'Precisions sur le besoin bancaire : banque preferee, dispositions deja prises, etc.';
