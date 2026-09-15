-- Bug capté en prod 2026-06-08 : Habiba (propria) INSÈRE une intervention
-- assignée à Ayoub. L'INSERT passe (is_staff() true), mais le .single()
-- qui suit déclenche un SELECT du new row → la policy READ exigeait
-- assigned_to_id = auth.uid(), ce qui est faux ici. Postgres renvoie alors
-- "row-level security policy violation" sur INSERT (côté supabase-js).
--
-- Fix : autoriser READ + UPDATE pour le créateur en plus de l'assigné.
-- Un propria voit donc TOUTES ses tâches (créées OU assignées à lui).

DROP POLICY IF EXISTS propria_interventions_read ON public.propria_interventions;
CREATE POLICY propria_interventions_read
ON public.propria_interventions
FOR SELECT
USING (
  (is_staff() AND current_role_name() <> 'propria')
  OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
  OR (current_role_name() = 'propria' AND created_by = auth.uid())
);

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

COMMENT ON POLICY propria_interventions_read ON public.propria_interventions IS
  'Back-office : tout. Propria : ses propres interventions (assignées OU créées). Indispensable pour que .single() après INSERT renvoie la ligne au créateur.';
