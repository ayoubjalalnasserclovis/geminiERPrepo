-- ─── Étape 5 Hostaway : liaison ménage ↔ réservation Hostaway ────────
-- CEO 2026-06-10 : création auto des ménages depuis les réservations
-- Hostaway. Deux mécaniques :
--   1) "voyageur"  : à chaque check-out → 1 ménage
--   2) "poussière" : à chaque check-in si la suite a été vide ≥ 4 jours
--
-- L'idempotence est garantie par un index unique partiel sur
-- (hostaway_reservation_id, auto_source).

ALTER TABLE public.propria_cleanings
  ADD COLUMN IF NOT EXISTS hostaway_reservation_id bigint,
  ADD COLUMN IF NOT EXISTS auto_source text CHECK (auto_source IN ('hostaway_voyageur','hostaway_poussiere')),
  ADD COLUMN IF NOT EXISTS auto_cancelled_at timestamptz;

COMMENT ON COLUMN public.propria_cleanings.hostaway_reservation_id IS
  'Lie le ménage à la réservation Hostaway source. Idempotence : un seul ménage voyageur par réservation, un seul ménage poussière par check-in.';
COMMENT ON COLUMN public.propria_cleanings.auto_source IS
  'Origine de la création automatique. NULL si créé manuellement par un membre de l''équipe.';
COMMENT ON COLUMN public.propria_cleanings.auto_cancelled_at IS
  'Posé quand le ménage est annulé auto (ex : réservation Hostaway annulée). Le statut passe à `annule` mais on garde la trace de la raison.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_propria_cleanings_hostaway_auto
  ON public.propria_cleanings(hostaway_reservation_id, auto_source)
  WHERE hostaway_reservation_id IS NOT NULL
    AND auto_source IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_propria_cleanings_hostaway_resa
  ON public.propria_cleanings(hostaway_reservation_id)
  WHERE hostaway_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_propria_cleanings_due_date
  ON public.propria_cleanings(due_date)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
