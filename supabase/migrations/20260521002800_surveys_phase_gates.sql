-- ============================================================================
-- Enquêtes de satisfaction obligatoires aux transitions de phase
-- Sourcing → Design       : enquête sur la phase Sourcing
-- Design → Travaux        : enquête sur la phase Design
-- Livraison → Mise en location : enquête sur la phase Livraison
-- Le client est bloqué côté portail tant que l'enquête n'est pas complétée.
-- ============================================================================

-- Index d'unicité (déjà présent en théorie via §3, on s'assure)
CREATE UNIQUE INDEX IF NOT EXISTS surveys_uniq_ix
  ON satisfaction_surveys (project_id, trigger_phase);

-- Mise à jour de la RPC advance_project_phase pour créer les enquêtes
CREATE OR REPLACE FUNCTION advance_project_phase(
  p_project_id UUID,
  p_new_phase project_phase
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
  v_survey_phase project_phase;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  IF NOT (
    (v_project.current_phase = 'onboarding'       AND p_new_phase = 'sourcing') OR
    (v_project.current_phase = 'sourcing'         AND p_new_phase = 'design')   OR
    (v_project.current_phase = 'design'           AND p_new_phase = 'travaux')  OR
    (v_project.current_phase = 'travaux'          AND p_new_phase = 'livraison') OR
    (v_project.current_phase = 'livraison'        AND p_new_phase = 'mise_en_location') OR
    (v_project.current_phase = 'mise_en_location' AND p_new_phase = 'termine')
  ) THEN
    RAISE EXCEPTION 'Transition non autorisée: % → %', v_project.current_phase, p_new_phase;
  END IF;

  IF v_project.current_phase = 'sourcing' AND p_new_phase = 'design' THEN
    IF v_project.property_id IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Design : aucun bien n''est encore validé pour ce projet';
    END IF;
    IF v_project.compromis_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Design : la date de signature du compromis n''est pas renseignée';
    END IF;
  END IF;

  IF v_project.current_phase = 'design' AND p_new_phase = 'travaux' THEN
    IF v_project.acte_authentique_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Travaux : la date de signature de l''acte authentique n''est pas renseignée';
    END IF;
  END IF;

  IF v_project.current_phase = 'travaux' AND p_new_phase = 'livraison' THEN
    IF v_project.travaux_start_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Livraison : la date de lancement de chantier n''est pas renseignée';
    END IF;
    IF v_project.travaux_end_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Livraison : la date de livraison du chantier n''est pas renseignée';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';

  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Tâches bloquantes ouvertes (%) sur la phase %', v_blocking_count, v_project.current_phase;
  END IF;

  UPDATE project_phases_history
    SET completed_at = now(), completed_by = v_user_id
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND completed_at IS NULL;

  UPDATE projects
    SET current_phase = p_new_phase, updated_at = now()
    WHERE id = p_project_id;

  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, p_new_phase, now());

  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT
      p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  IF p_new_phase = 'sourcing' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_compromis', 3800, 'sourcing', CURRENT_DATE + 30);
  ELSIF p_new_phase = 'design' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_3d', 3800, 'design', CURRENT_DATE + 14);
  ELSIF p_new_phase = 'travaux' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_chantier', 4200, 'travaux', CURRENT_DATE);
  ELSIF p_new_phase = 'livraison' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_livraison', 4200, 'livraison', CURRENT_DATE);
  END IF;

  -- ─── NOUVEAU : création de l'enquête de satisfaction ──────────────────
  -- L'enquête porte sur la phase qui vient de se terminer.
  v_survey_phase := NULL;
  IF p_new_phase = 'design' THEN
    v_survey_phase := 'sourcing';
  ELSIF p_new_phase = 'travaux' THEN
    v_survey_phase := 'design';
  ELSIF p_new_phase = 'mise_en_location' THEN
    v_survey_phase := 'livraison';
  END IF;

  IF v_survey_phase IS NOT NULL AND v_project.client_id IS NOT NULL THEN
    INSERT INTO satisfaction_surveys (project_id, client_id, trigger_phase, sent_at)
    VALUES (p_project_id, v_project.client_id, v_survey_phase, now())
    ON CONFLICT (project_id, trigger_phase) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_phase', p_new_phase);
END;
$$;
