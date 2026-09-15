-- ─── Chantier 7 marathon (U9 + U10, décisions CEO B5/C4) — Avis enrichis ────
--
-- 1. QCM « cause principale » pour un avis préventif NÉGATIF :
--    colonne main_cause sur hostaway_pre_review_tracking (nullable, la table
--    dédiée des préventifs — les avis publiés restent dans hostaway_reviews).
-- 2. Journal complet des avis (publiés + préventifs) :
--    table propria_review_events — chaque changement de statut / relance /
--    sentiment / cause / assignation est loggé en best-effort par les
--    server actions (app/(team)/propria/avis/actions.ts).
--    review_kind='avis'      → review_id = hostaway_reviews.id
--    review_kind='preventif' → review_id = hostaway_pre_review_tracking.id
--    (polymorphe, pas de FK — même pattern que propria_comments).
--
-- Idempotent : IF NOT EXISTS / DROP IF EXISTS partout, re-run sans effet.

-- ─── 1) Cause principale (préventif négatif, QCM) ────────────────────────
ALTER TABLE public.hostaway_pre_review_tracking
  ADD COLUMN IF NOT EXISTS main_cause text;

ALTER TABLE public.hostaway_pre_review_tracking
  DROP CONSTRAINT IF EXISTS hostaway_pre_review_tracking_main_cause_check;
ALTER TABLE public.hostaway_pre_review_tracking
  ADD CONSTRAINT hostaway_pre_review_tracking_main_cause_check
  CHECK (main_cause IS NULL OR main_cause IN
    ('menage','acces','cle','climatisation','internet','bruit',
     'communication','equipement','prix','autre'));

COMMENT ON COLUMN public.hostaway_pre_review_tracking.main_cause IS
  'Cause principale du risque de mauvais avis (QCM chantier 7 marathon). Renseignée quand le sentiment est négatif. Nullable.';

-- ─── 2) Journal des avis (publiés + préventifs) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.propria_review_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_kind text NOT NULL CHECK (review_kind IN ('avis','preventif')),
  review_id   uuid NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('statut','relance','sentiment','cause','assignation','autre')),
  description text,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_propria_review_events_review
  ON public.propria_review_events(review_kind, review_id, created_at)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.propria_review_events IS
  'Journal des avis (chantier 7 marathon) : événements statut/relance/sentiment/cause/assignation, loggés best-effort par les server actions. Soft-delete uniquement (deleted_at). review_id polymorphe selon review_kind.';

ALTER TABLE public.propria_review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read review_events"   ON public.propria_review_events;
DROP POLICY IF EXISTS "staff insert review_events" ON public.propria_review_events;
DROP POLICY IF EXISTS "ceo update review_events"   ON public.propria_review_events;
DROP POLICY IF EXISTS "ceo delete review_events"   ON public.propria_review_events;
CREATE POLICY "staff read review_events" ON public.propria_review_events
  FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert review_events" ON public.propria_review_events
  FOR INSERT WITH CHECK (public.is_staff());
-- UPDATE réservé CEO : sert uniquement au soft-delete (deleted_at).
CREATE POLICY "ceo update review_events" ON public.propria_review_events
  FOR UPDATE USING (public.is_staff(ARRAY['ceo']));
CREATE POLICY "ceo delete review_events" ON public.propria_review_events
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

NOTIFY pgrst, 'reload schema';
