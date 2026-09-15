-- TVA calculation on bank transactions (CEO 2026-09-02)
--
-- Colonne tva_treatment sur bank_transactions pour piloter le calcul TVA
-- automatique du mois. Valeurs :
--   - auto        : appliquer les regles par categorie (defaut)
--   - collectee   : force TVA collectee 20% (revenu assujetti)
--   - deductible  : force TVA deductible 20% (charge avec facture)
--   - exoneree    : pas de TVA (impots, salaires, remboursement pret, etc.)
--   - a_qualifier : a revoir (le CEO doit trancher)
--
-- Migration deja appliquee en prod le 2026-09-02.

DO $$ BEGIN
  CREATE TYPE tva_treatment_t AS ENUM ('auto','collectee','deductible','exoneree','a_qualifier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS tva_treatment tva_treatment_t NOT NULL DEFAULT 'auto';

CREATE INDEX IF NOT EXISTS bank_transactions_tva_treatment_idx
  ON public.bank_transactions (tva_treatment)
  WHERE deleted_at IS NULL AND tva_treatment <> 'auto';

COMMENT ON COLUMN public.bank_transactions.tva_treatment IS
  'Traitement TVA : auto (regles par categorie) ou override manuel. CEO 2026-09-02.';
