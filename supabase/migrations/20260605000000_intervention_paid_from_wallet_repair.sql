-- ============================================================================
-- Réparation : la colonne paid_from_wallet_id n'a pas été créée par la migration
-- précédente (20260604000000_intervention_wallet_link) — la migration s'est
-- enregistrée comme appliquée mais l'ADD COLUMN IF NOT EXISTS n'a rien produit
-- sur la table propria_interventions. Cause probable : un état BDD incohérent
-- au moment du run. On reposte donc l'opération de façon idempotente.
--
-- Symptôme : crash "Server Components render" sur /propria/interventions/new
-- au submit, car le code écrit paid_from_wallet_id alors que la colonne manque.
-- ============================================================================

ALTER TABLE public.propria_interventions
  ADD COLUMN IF NOT EXISTS paid_from_wallet_id uuid
    REFERENCES public.propria_wallets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_propria_interventions_paid_from_wallet
  ON public.propria_interventions(paid_from_wallet_id)
  WHERE paid_from_wallet_id IS NOT NULL;

COMMENT ON COLUMN public.propria_interventions.paid_from_wallet_id IS
  'Caisse Propria depuis laquelle cette intervention a été payée. NULL = pas de débours cash (ex: prestataire payé en virement). Champ "Payé depuis la caisse de" dans le formulaire.';
