-- Décision CEO 2026-06-08 : le créateur DOIT pouvoir piloter le workflow
-- même quand il a assigné la tâche à quelqu'un d'autre (entraide terrain,
-- backup si l'assigné n'est pas disponible). On réétend donc UPDATE au
-- créateur, comme l'était la 1re version de la policy (20260608100000).

DROP POLICY IF EXISTS propria_interventions_update ON public.propria_interventions;
CREATE POLICY propria_interventions_update
ON public.propria_interventions
FOR UPDATE
USING (
  (is_staff() AND current_role_name() <> 'propria')
  OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
  OR (current_role_name() = 'propria' AND created_by = auth.uid())
)
WITH CHECK (
  (is_staff() AND current_role_name() <> 'propria')
  OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
  OR (current_role_name() = 'propria' AND created_by = auth.uid())
);

COMMENT ON POLICY propria_interventions_update ON public.propria_interventions IS
  'Propria : peut modifier ses tâches ASSIGNÉES ou CRÉÉES. Le créateur peut piloter le workflow d''une tâche déléguée — utile pour reprendre la main si l''assigné n''est pas dispo.';
