-- Métier 2026-06-08 : un propria ne peut MODIFIER (démarrer/soumettre…) que
-- les tâches qui lui sont ASSIGNÉES. Le créateur (Habiba qui assigne à Ayoub)
-- peut VOIR la tâche mais pas la modifier — c'est Ayoub qui pilote son boulot.
-- READ reste étendu au créateur (utile pour la vue détail post-création).

DROP POLICY IF EXISTS propria_interventions_update ON public.propria_interventions;
CREATE POLICY propria_interventions_update
ON public.propria_interventions
FOR UPDATE
USING (
  (is_staff() AND current_role_name() <> 'propria')
  OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
)
WITH CHECK (
  (is_staff() AND current_role_name() <> 'propria')
  OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
);

COMMENT ON POLICY propria_interventions_update ON public.propria_interventions IS
  'Propria : peut modifier UNIQUEMENT ses tâches assignées. Le créateur (qui a assigné à un autre) peut lire mais pas modifier — c''est l''assigné qui pilote le workflow.';
