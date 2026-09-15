-- CEO 2026-06-10 : assignation d'un membre equipe (propria/ceo) sur les avis publies.
-- Le tracking preventif a deja assignee_id depuis la migration precedente.

ALTER TABLE public.hostaway_reviews
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_assignee
  ON public.hostaway_reviews(assignee_id) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
