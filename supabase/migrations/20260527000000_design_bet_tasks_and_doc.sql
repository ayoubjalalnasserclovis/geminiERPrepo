-- ============================================================================
-- Phase Design — ajout des tâches "bureau d'études" + document plan_bet
-- + gate de validation client obligatoire avant passage en Travaux
-- ============================================================================

-- 1. Ajouter `plan_bet` dans la liste des types de documents autorisés
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_type_check CHECK (type IN (
    'cahier_des_charges',
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'plan_bet',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'autre'
  ));

-- 2. Ajouter les 2 task_templates pour la phase design
INSERT INTO task_templates (phase, title, description, default_assigned_role, order_index, is_blocking)
VALUES
  ('design', 'Faire passer le bureau d''études',
   'Coordonner la visite du bureau d''études (BET) sur le bien pour relever les contraintes techniques et préparer les plans (structure, fluides, électricité).',
   'chef_projet', 22, true),
  ('design', 'Collecter le plan du bureau d''études',
   'Récupérer le plan définitif du BET, l''uploader dans Documents (type "plan_bet"), et le marquer "à valider par le client". Le client doit valider avant de pouvoir passer en phase Travaux.',
   'chef_projet', 27, true)
ON CONFLICT DO NOTHING;

-- 3. Ajouter un gate dans advance_project_phase : design → travaux doit avoir plan_bet validé par le client
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

  -- Gates phase Design (compromis + date)
  IF v_project.current_phase = 'sourcing' AND p_new_phase = 'design' THEN
    IF v_project.property_id IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Design : aucun bien n''est encore validé pour ce projet';
    END IF;
    IF v_project.compromis_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Design : la date de signature du compromis n''est pas renseignée';
    END IF;
  END IF;

  -- Gates phase Travaux (acte authentique + dossier archi + plan BET validé client)
  IF v_project.current_phase = 'design' AND p_new_phase = 'travaux' THEN
    IF v_project.acte_authentique_date IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en Travaux : la date de signature de l''acte authentique n''est pas renseignée';
    END IF;
    -- Dossier architecture : 3 fichiers requis
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plans_3d' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : plans 3D (dossier architecture).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'lots_techniques' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : lots techniques (dossier architecture).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'shopping_list' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : shopping list (dossier architecture).';
    END IF;
    -- NOUVEAU : Plan BET obligatoirement uploadé ET validé par le client
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plan_bet' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : plan du bureau d''études (BET). Uploadez-le dans Documents.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents
      WHERE project_id = p_project_id
        AND type = 'plan_bet'
        AND deleted_at IS NULL
        AND client_validation_status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Le plan du bureau d''études (BET) doit être validé par le client avant de passer en phase Travaux.';
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

  -- Tâches bloquantes
  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';
  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Tâches bloquantes ouvertes (%) sur la phase %', v_blocking_count, v_project.current_phase;
  END IF;

  -- Bascule
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

  -- Génération auto des tâches de la nouvelle phase
  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT
      p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  -- Génération auto des paiements
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

  -- Création enquête de satisfaction
  v_survey_phase := NULL;
  IF p_new_phase = 'design'           THEN v_survey_phase := 'sourcing';
  ELSIF p_new_phase = 'travaux'       THEN v_survey_phase := 'design';
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
