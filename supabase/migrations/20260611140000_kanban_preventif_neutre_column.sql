-- Kanban avis preventif : nouvelle colonne 'neutre' (CEO 2026-06-11).
--
-- Avant : sentiment neutre etait classe dans 'risque', ce qui rendait
-- le kanban illisible (les vrais risques se noyaient avec les neutres).
-- Maintenant : colonne dediee 'neutre' entre 'risque' et 'bon'.

-- 1) Etendre le CHECK constraint pour inclure 'neutre'
ALTER TABLE public.hostaway_pre_review_tracking
  DROP CONSTRAINT IF EXISTS hostaway_pre_review_tracking_kanban_status_check;

ALTER TABLE public.hostaway_pre_review_tracking
  ADD CONSTRAINT hostaway_pre_review_tracking_kanban_status_check
  CHECK (kanban_status = ANY (ARRAY[
    'nouveau'::text, 'risque'::text, 'neutre'::text, 'bon'::text,
    'action_lancee'::text, 'accomplie'::text, 'ratee'::text
  ]));

-- 2) Backfill : tous les trackings actifs avec sentiment='neutre' et
-- kanban_status='risque' basculent vers 'neutre'. On ne touche pas aux
-- statuts terminaux (accomplie/ratee/action_lancee : on respecte l'historique).
UPDATE public.hostaway_pre_review_tracking
SET kanban_status = 'neutre'
WHERE sentiment = 'neutre'
  AND kanban_status = 'risque'
  AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
