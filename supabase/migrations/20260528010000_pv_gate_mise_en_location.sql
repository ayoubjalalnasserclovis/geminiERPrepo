-- ============================================================================
-- Gate phase : Livraison → Mise en location bloquée tant que le PV n'est pas
-- validé (signé par le client). Réutilise la fonction helper créée dans
-- 20260528009000_vct_and_reception_pv.sql : check_pv_validated_for_mise_en_location()
-- ============================================================================
-- Recopie de la fonction advance_project_phase (dernière version du 20260527007000)
-- avec ajout du check PV après le check livraison_date.
-- ============================================================================

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
  v_pv_error TEXT;
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
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plans_3d' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : plans 3D (dossier architecture).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'lots_techniques' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : lots techniques (dossier architecture).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'shopping_list' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : shopping list (dossier architecture).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plan_bet' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : plan du bureau d''études (BET). Uploadez-le dans Documents.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents
      WHERE project_id = p_project_id AND type = 'plan_bet'
        AND deleted_at IS NULL AND client_validation_status = 'validated'
    ) THEN
      RAISE EXCEPTION 'Le plan du bureau d''études (BET) doit être validé par le client avant de passer en phase Travaux.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'devis_travaux' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : devis travaux. Uploadez-le dans Documents.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents
      WHERE project_id = p_project_id AND type = 'devis_travaux'
        AND deleted_at IS NULL AND client_validation_status = 'validated'
    ) THEN
      RAISE EXCEPTION 'Le devis travaux doit être validé par le client avant de passer en phase Travaux.';
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

  -- Gates phase Mise en location
  IF v_project.current_phase = 'livraison' AND p_new_phase = 'mise_en_location' THEN
    IF v_project.livraison_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Mise en location : la date de remise des clés au client n''est pas renseignée';
    END IF;

    -- ⭐ NOUVEAU : le PV de réception doit être signé par le client
    v_pv_error := check_pv_validated_for_mise_en_location(p_project_id);
    IF v_pv_error IS NOT NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Mise en location : %', v_pv_error;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'titre_foncier' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : titre foncier.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'autorisation_travaux' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : autorisation de travaux.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_eau' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat eau.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_electricite' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat électricité.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_assurance' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat d''assurance.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_internet' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat internet/fibre.';
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

  -- Surveys auto déclenchées sur transitions clés
  -- (note : l'enquête livraison peut aussi être déclenchée au moment de la signature PV
  -- via clientSignPvAction — la contrainte UNIQUE (project_id, trigger_phase) garantit l'idempotence)
  v_survey_phase := NULL;
  IF p_new_phase = 'design'              THEN v_survey_phase := 'sourcing';
  ELSIF p_new_phase = 'travaux'          THEN v_survey_phase := 'design';
  ELSIF p_new_phase = 'mise_en_location' THEN v_survey_phase := 'livraison';
  END IF;

  IF v_survey_phase IS NOT NULL AND v_project.client_id IS NOT NULL THEN
    INSERT INTO satisfaction_surveys (project_id, client_id, trigger_phase, sent_at)
    VALUES (p_project_id, v_project.client_id, v_survey_phase, now())
    ON CONFLICT (project_id, trigger_phase) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_phase', p_new_phase);
END;
$$;

COMMENT ON FUNCTION advance_project_phase IS
  'Avance la phase d''un projet en vérifiant tous les gates (dates, documents, tâches, PV de réception). Idempotent sur les surveys.';
