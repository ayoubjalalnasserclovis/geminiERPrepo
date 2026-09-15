-- ============================================================================
-- Fix : permettre au staff d'INSÉRER dans project_phases_history
-- (les policies initiales ne couvraient que SELECT, ce qui bloquait les
--  triggers init_new_project et advance_project_phase pour les non-superusers)
-- ============================================================================

-- Politique permissive d'INSERT / UPDATE / DELETE pour le staff
CREATE POLICY phh_staff_write ON project_phases_history FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

-- En complément, on sécurise les triggers en SECURITY DEFINER
-- (bypass RLS dans tous les cas — plus robuste pour les opérations système)

CREATE OR REPLACE FUNCTION init_new_project() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_phases_history (project_id, phase, started_at)
    VALUES (NEW.id, 'onboarding', NEW.created_at);

  INSERT INTO public.payments (project_id, type, amount_expected, due_at_phase, due_date)
    VALUES (NEW.id, 'acompte_stoniz', 5000, 'onboarding', CURRENT_DATE);

  INSERT INTO public.tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated)
    SELECT
      NEW.id,
      t.id,
      t.phase,
      t.title,
      t.description,
      (SELECT id FROM public.profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking,
      true
    FROM public.task_templates t
    WHERE t.phase = 'onboarding' AND t.is_active = true
    ORDER BY t.order_index;

  RETURN NEW;
END;
$$;
