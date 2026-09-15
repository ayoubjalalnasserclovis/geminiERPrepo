-- ─── Push B : historique d'activité des interventions/tâches ──────────
-- CEO 2026-06-09 : chaque édition, changement de statut, validation ou
-- assignation laisse une trace dans cette table. Affiché en timeline sur
-- la fiche détail d'une intervention/tâche.
--
-- payload est intentionnellement libre (jsonb) pour s'adapter à chaque
-- type d'action :
--   • created      → { kind, urgency }
--   • edited       → { diff: { description: {before, after}, ... } }
--   • status_changed → { from: 'a_traiter', to: 'en_cours' }
--   • assigned     → { assigned_to_id, assigned_to_name, via: 'bulk' | null }
--   • submitted    → null
--   • validated    → null
--   • refused      → { reason }
--   • cancelled    → null
--   • reopened     → null

CREATE TABLE IF NOT EXISTS public.propria_intervention_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NOT NULL REFERENCES public.propria_interventions(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'created','edited','status_changed','assigned','unassigned',
    'submitted','validated','refused','cancelled','reopened'
  )),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propria_intervention_activity_int
  ON public.propria_intervention_activity(intervention_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_propria_intervention_activity_actor
  ON public.propria_intervention_activity(actor_id);

COMMENT ON TABLE public.propria_intervention_activity IS
  'Journal d''activité des interventions/tâches Propria. Une ligne par action significative (création, édition, changement de statut, validation, assignation). Affiché en timeline sur la fiche détail.';

-- RLS : staff lecture + insertion ; historique immuable (pas de UPDATE/DELETE policies)
ALTER TABLE public.propria_intervention_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read activity" ON public.propria_intervention_activity;
CREATE POLICY "staff read activity"
  ON public.propria_intervention_activity
  FOR SELECT
  USING (public.is_staff());

DROP POLICY IF EXISTS "staff insert activity" ON public.propria_intervention_activity;
CREATE POLICY "staff insert activity"
  ON public.propria_intervention_activity
  FOR INSERT
  WITH CHECK (public.is_staff());

NOTIFY pgrst, 'reload schema';
