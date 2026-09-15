-- ============================================================================
-- Refonte : les paiements Stoniz ne sont plus créés à l'entrée de phase
-- mais déclenchés par les vrais événements métier :
--   • acompte_stoniz        = à la création du projet (contrat signé en amont)
--   • honoraires_compromis  = quand compromis_date est renseignée
--   • honoraires_3d         = quand un doc plans_3d visible client est uploadé
--   • honoraires_chantier   = quand travaux_start_date est renseignée (J-7)
--   • honoraires_livraison  = quand livraison_date est renseignée
-- ============================================================================

-- 1. Helper idempotent : crée le paiement s'il n'existe pas,
--    met à jour la due_date sinon, NE TOUCHE PAS si déjà payé.
CREATE OR REPLACE FUNCTION upsert_milestone_payment(
  p_project_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_due_date DATE,
  p_due_at_phase project_phase DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing payments;
BEGIN
  SELECT * INTO v_existing FROM payments
    WHERE project_id = p_project_id
      AND type = p_type
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_existing.id IS NULL THEN
    INSERT INTO payments (project_id, type, amount_expected, due_date, due_at_phase)
    VALUES (p_project_id, p_type, p_amount, p_due_date, p_due_at_phase);
    RETURN jsonb_build_object('action', 'created', 'type', p_type, 'due_date', p_due_date);
  ELSIF v_existing.status = 'paid' THEN
    RETURN jsonb_build_object('action', 'already_paid', 'type', p_type);
  ELSE
    -- On met à jour uniquement la due_date pour aligner sur l'événement réel
    UPDATE payments SET due_date = p_due_date WHERE id = v_existing.id;
    RETURN jsonb_build_object('action', 'updated', 'type', p_type, 'due_date', p_due_date);
  END IF;
END;
$$;

-- 2. Retire la génération automatique de paiements de advance_project_phase
--    (on garde tout le reste : gates, transitions, history, tasks, surveys)
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

  -- Tâches auto
  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT
      p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  -- NOTE : la génération automatique des paiements a été retirée d'ici.
  -- Les paiements Stoniz sont maintenant déclenchés par les vrais événements métier
  -- depuis les Server Actions (createProject, updateProjectDates, uploadDocument).

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

-- 3. Backfill des projets existants : aligne les due_dates sur les vrais événements
DO $$
DECLARE
  p RECORD;
  v_plans_3d_date TIMESTAMPTZ;
BEGIN
  FOR p IN
    SELECT id, created_at, compromis_date, travaux_start_date, livraison_date
    FROM projects WHERE deleted_at IS NULL
  LOOP
    -- Acompte Stoniz : toujours dû dès création
    PERFORM upsert_milestone_payment(p.id, 'acompte_stoniz', 5000, p.created_at::date, 'onboarding');

    -- Compromis
    IF p.compromis_date IS NOT NULL THEN
      PERFORM upsert_milestone_payment(p.id, 'honoraires_compromis', 3800, p.compromis_date::date, 'sourcing');
    END IF;

    -- 3D : date du premier upload visible client
    SELECT MIN(created_at) INTO v_plans_3d_date
      FROM documents
      WHERE project_id = p.id
        AND type = 'plans_3d'
        AND is_visible_to_client = true
        AND deleted_at IS NULL;
    IF v_plans_3d_date IS NOT NULL THEN
      PERFORM upsert_milestone_payment(p.id, 'honoraires_3d', 3800, v_plans_3d_date::date, 'design');
    END IF;

    -- Chantier : J-7 du démarrage
    IF p.travaux_start_date IS NOT NULL THEN
      PERFORM upsert_milestone_payment(p.id, 'honoraires_chantier', 4200, (p.travaux_start_date::date - INTERVAL '7 days')::date, 'travaux');
    END IF;

    -- Livraison
    IF p.livraison_date IS NOT NULL THEN
      PERFORM upsert_milestone_payment(p.id, 'honoraires_livraison', 4200, p.livraison_date::date, 'livraison');
    END IF;
  END LOOP;
END $$;
