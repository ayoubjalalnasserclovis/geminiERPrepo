-- ============================================================================
-- advance_project_phase — Tolérance des appels système (auth.uid() NULL)
-- ============================================================================
-- Bug observé : depuis le SQL editor Supabase (rôle postgres sans JWT) ou
-- depuis un cron / script utilisant la service role key, auth.uid() retourne
-- NULL. La version précédente bloquait alors avec "seul un super-admin peut
-- faire avancer ce projet" même si l'appelant a TOUS les pouvoirs DB.
--
-- Correctif : si auth.uid() IS NULL, on considère qu'il s'agit d'un appel
-- système (service role) et on traite comme super-admin. Pour la traçabilité
-- du bypass, on utilise comme fallback prepared_by du projet ou n'importe
-- quel super-admin actif, dans cet ordre.
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
  v_property properties;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
  v_effective_user_id UUID;
  v_is_super_admin BOOLEAN;
  v_skipped_gates TEXT[] := '{}';
  v_in_prep BOOLEAN;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  v_in_prep := COALESCE(v_project.is_preparation, false);

  -- Détection super-admin :
  --   - auth.uid() NULL → appel système (service role, SQL editor) → super-admin
  --   - sinon, lit le flag sur profiles
  IF v_user_id IS NULL THEN
    v_is_super_admin := true;
    -- Pour la traçabilité du bypass on a besoin d'un UUID valide
    v_effective_user_id := COALESCE(
      v_project.prepared_by,
      (SELECT id FROM profiles WHERE is_super_admin = true AND is_active = true ORDER BY created_at ASC LIMIT 1)
    );
  ELSE
    SELECT is_super_admin INTO v_is_super_admin FROM profiles WHERE id = v_user_id;
    v_is_super_admin := COALESCE(v_is_super_admin, false);
    v_effective_user_id := v_user_id;
  END IF;

  -- Transition autorisée (toujours, même en bypass)
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

  IF v_in_prep AND NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Phase en mode préparation : seul un super-admin peut faire avancer ce projet.';
  END IF;

  -- ÉVALUATION DES GATES
  IF p_new_phase IN ('design','travaux','livraison','mise_en_location','termine') THEN
    IF v_project.property_id IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'property_missing');
    END IF;
    IF v_project.compromis_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'compromis_date_missing');
    END IF;
  END IF;

  IF p_new_phase IN ('travaux','livraison','mise_en_location','termine') THEN
    IF v_project.acte_authentique_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'acte_authentique_date_missing');
    END IF;
  END IF;

  IF p_new_phase IN ('livraison','mise_en_location','termine') THEN
    IF v_project.travaux_start_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'travaux_start_date_missing');
    END IF;
    IF v_project.travaux_end_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'travaux_end_date_missing');
    END IF;
  END IF;

  IF p_new_phase IN ('mise_en_location','termine') THEN
    IF v_project.livraison_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'livraison_date_missing');
    END IF;
  END IF;

  IF p_new_phase = 'travaux' THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'compromis' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_compromis');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plans_3d' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_plans_3d');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'lots_techniques' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_lots_techniques');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'shopping_list' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_shopping_list');
    END IF;
  END IF;

  IF p_new_phase = 'mise_en_location' THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'titre_foncier' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_titre_foncier');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'autorisation_travaux' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_autorisation_travaux');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_eau' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_contrat_eau');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_electricite' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_contrat_electricite');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_assurance' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_contrat_assurance');
    END IF;

    IF v_project.property_id IS NOT NULL THEN
      SELECT * INTO v_property FROM properties WHERE id = v_project.property_id;
      IF v_property.propria_water_contract IS NULL OR length(trim(v_property.propria_water_contract)) = 0 THEN
        v_skipped_gates := array_append(v_skipped_gates, 'contract_number_missing_eau');
      END IF;
      IF v_property.propria_electricity_contract IS NULL OR length(trim(v_property.propria_electricity_contract)) = 0 THEN
        v_skipped_gates := array_append(v_skipped_gates, 'contract_number_missing_electricite');
      END IF;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';
  IF v_blocking_count > 0 THEN
    v_skipped_gates := array_append(v_skipped_gates,
      format('blocking_tasks_%s_on_phase_%s', v_blocking_count, v_project.current_phase));
  END IF;

  IF array_length(v_skipped_gates, 1) > 0 THEN
    IF v_in_prep AND v_is_super_admin THEN
      INSERT INTO project_phase_bypass_log (
        project_id, from_phase, to_phase, bypassed_by,
        gates_skipped, reason, still_in_preparation
      ) VALUES (
        p_project_id, v_project.current_phase, p_new_phase, v_effective_user_id,
        v_skipped_gates,
        CASE WHEN v_user_id IS NULL
          THEN 'Mode préparation — appel système (service role / SQL editor)'
          ELSE 'Mode préparation — bypass automatique'
        END,
        true
      );
    ELSE
      RAISE EXCEPTION 'Transition bloquée : %', v_skipped_gates[1]
        USING HINT = 'Champs/documents manquants : ' || array_to_string(v_skipped_gates, ', ');
    END IF;
  END IF;

  -- AVANCEMENT EFFECTIF
  UPDATE project_phases_history
    SET completed_at = now(), completed_by = v_effective_user_id
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND completed_at IS NULL;

  UPDATE projects
    SET current_phase = p_new_phase, updated_at = now()
    WHERE id = p_project_id;

  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, p_new_phase, now());

  -- Pas de création auto de tâches ni paiements en mode préparation
  IF NOT v_in_prep THEN
    INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
      SELECT p_project_id, t.id, t.phase, t.title, t.description,
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
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'new_phase', p_new_phase,
    'bypassed', (array_length(v_skipped_gates, 1) > 0 AND v_in_prep),
    'gates_skipped', v_skipped_gates,
    'caller_was_system', (v_user_id IS NULL)
  );
END;
$$;
