-- ─── Push 3 : Demande de paiement groupée (batch) ──────────────────────
-- Permet d'envoyer 1 seule demande de validation au CEO/finance pour N
-- acomptes d'un même fournisseur, au lieu de N demandes = N mails.
--
-- Modèle :
--   • achats_payments.payment_batch_id : uuid partagé entre les N acomptes
--     créés par bulkPlanAchatAcomptesAction (ou attribué a posteriori).
--   • payment_approvals.payment_batch_id : 4e source possible (exclusive
--     mutuelle avec les 3 autres FK). Quand renseignée, la demande couvre
--     tous les achats_payments du batch.

-- 1) Colonne batch_id sur les acomptes achats
ALTER TABLE public.achats_payments
  ADD COLUMN IF NOT EXISTS payment_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_achats_payments_batch
  ON public.achats_payments(payment_batch_id)
  WHERE payment_batch_id IS NOT NULL;

COMMENT ON COLUMN public.achats_payments.payment_batch_id IS
  'Identifiant de batch partagé entre N acomptes créés ensemble pour un même fournisseur. Permet la validation groupée via payment_approvals.payment_batch_id.';

-- 2) Colonne batch_id sur les demandes d''approbation
ALTER TABLE public.payment_approvals
  ADD COLUMN IF NOT EXISTS payment_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_payment_approvals_batch
  ON public.payment_approvals(payment_batch_id)
  WHERE payment_batch_id IS NOT NULL;

COMMENT ON COLUMN public.payment_approvals.payment_batch_id IS
  'Lorsque renseigné, la demande couvre tous les achats_payments dont payment_batch_id = celui-ci. Exclut les 3 autres FK source (one_source_only).';

-- 3) Remplacer one_source_only pour intégrer le batch comme 4e source possible
ALTER TABLE public.payment_approvals
  DROP CONSTRAINT IF EXISTS one_source_only;

ALTER TABLE public.payment_approvals
  ADD CONSTRAINT one_source_only CHECK (
    (
      (CASE WHEN payment_id        IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN travaux_payment_id IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN achats_payment_id  IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN payment_batch_id   IS NULL THEN 0 ELSE 1 END)
    ) = 1
  );

-- 4) Pour PostgREST : recharger le schema cache
NOTIFY pgrst, 'reload schema';
