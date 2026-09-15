-- Ajoute la notion d'encaissement PROGRAMMÉ (à recevoir) sur travaux et achats.
-- Permet de piloter la trésorerie à 30/60/90j en intégrant aussi les rentrées
-- futures, pas seulement les rentrées historiques.
--
-- Modèle :
--   • status = 'recu'      → encaissement effectif, received_at obligatoire
--   • status = 'planifie'  → à recevoir, scheduled_date obligatoire, received_at facultatif
-- received_at devient NULLABLE pour autoriser un planifié sans paiement.

ALTER TABLE public.travaux_encaissements
  ALTER COLUMN received_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'recu';

ALTER TABLE public.achats_encaissements
  ALTER COLUMN received_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'recu';

-- Garde-fou : si planifié et NULL scheduled_date OU si reçu et NULL received_at,
-- on bloque côté BDD pour éviter les états incohérents.
ALTER TABLE public.travaux_encaissements
  DROP CONSTRAINT IF EXISTS travaux_encaissements_status_check,
  ADD CONSTRAINT travaux_encaissements_status_check CHECK (
    (status = 'recu' AND received_at IS NOT NULL)
    OR (status = 'planifie' AND scheduled_date IS NOT NULL)
  );

ALTER TABLE public.achats_encaissements
  DROP CONSTRAINT IF EXISTS achats_encaissements_status_check,
  ADD CONSTRAINT achats_encaissements_status_check CHECK (
    (status = 'recu' AND received_at IS NOT NULL)
    OR (status = 'planifie' AND scheduled_date IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_travaux_encaissements_scheduled_planifie
  ON public.travaux_encaissements(scheduled_date)
  WHERE status = 'planifie' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_achats_encaissements_scheduled_planifie
  ON public.achats_encaissements(scheduled_date)
  WHERE status = 'planifie' AND deleted_at IS NULL;

COMMENT ON COLUMN public.travaux_encaissements.scheduled_date IS
  'Date d''échéance prévue (obligatoire si status=planifie). NULL si encaissement déjà reçu.';
COMMENT ON COLUMN public.achats_encaissements.scheduled_date IS
  'Date d''échéance prévue (obligatoire si status=planifie). NULL si encaissement déjà reçu.';
