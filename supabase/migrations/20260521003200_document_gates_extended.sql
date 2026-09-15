-- ============================================================================
-- Gates documents et contrats utilités étendus pour transitions de phase
-- Design → Travaux  : compromis + dossier architecture (3 docs) requis
-- Livraison → Mise en location : titre foncier + autorisation travaux +
--                                contrats eau / électricité / assurance +
--                                n° contrats eau & électricité
-- ============================================================================

-- ─── 1. Nouveaux types de documents ─────────────────────────────────────
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list','permis_travaux',
    'photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'contrat_eau','contrat_electricite','contrat_assurance',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'autre'
  ));

-- ─── 2. Numéros de contrats utilités sur le projet ──────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS water_contract_number TEXT,
  ADD COLUMN IF NOT EXISTS electricity_contract_number TEXT;

COMMENT ON COLUMN projects.water_contract_number IS
  'Numéro de contrat eau — obligatoire pour passer en Mise en location';
COMMENT ON COLUMN projects.electricity_contract_number IS
  'Numéro de contrat électricité — obligatoire pour passer en Mise en location';

-- ─── 3. RPC advance_project_phase avec gates documents ──────────────────
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
  v_missing_doc TEXT;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  -- Transition autorisée
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

  -- ─── Gates dates (cumulatifs) ────────────────────────────────────────
  IF p_new_phase IN ('design','travaux','livraison','mise_en_location','termine') THEN
    IF v_project.property_id IS NULL THEN
      RAISE EXCEPTION 'Aucun bien n''est validé pour ce projet. Acceptez d''abord une proposition.';
    END IF;
    IF v_project.compromis_date IS NULL THEN
      RAISE EXCEPTION 'Date de signature du compromis manquante (requise pour Design et au-delà).';
    END IF;
  END IF;

  IF p_new_phase IN ('travaux','livraison','mise_en_location','termine') THEN
    IF v_project.acte_authentique_date IS NULL THEN
      RAISE EXCEPTION 'Date de signature de l''acte authentique manquante.';
    END IF;
  END IF;

  IF p_new_phase IN ('livraison','mise_en_location','termine') THEN
    IF v_project.travaux_start_date IS NULL THEN
      RAISE EXCEPTION 'Date de lancement de chantier manquante.';
    END IF;
    IF v_project.travaux_end_date IS NULL THEN
      RAISE EXCEPTION 'Date de livraison du chantier (fin travaux) manquante.';
    END IF;
  END IF;

  IF p_new_phase IN ('mise_en_location','termine') THEN
    IF v_project.livraison_date IS NULL THEN
      RAISE EXCEPTION 'Date de remise des clés au client manquante.';
    END IF;
  END IF;

  -- ─── Gates documents pour Design → Travaux ───────────────────────────
  IF p_new_phase = 'travaux' THEN
    -- Compromis de vente
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'compromis' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : compromis de vente (à uploader dans Documents).';
    END IF;
    -- Dossier architecture : 3 fichiers requis
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plans_3d' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : plans 3D (dossier architecture).';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'lots_techniques' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : lots techniques (dossier architecture).';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'shopping_list' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : shopping list (dossier architecture).';
    END IF;
  END IF;

  -- ─── Gates documents et n° contrats pour Livraison → Mise en location ─
  IF p_new_phase = 'mise_en_location' THEN
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
    IF v_project.water_contract_number IS NULL OR v_project.water_contract_number = '' THEN
      RAISE EXCEPTION 'Numéro de contrat eau manquant (carte Contrats utilités).';
    END IF;
    IF v_project.electricity_contract_number IS NULL OR v_project.electricity_contract_number = '' THEN
      RAISE EXCEPTION 'Numéro de contrat électricité manquant (carte Contrats utilités).';
    END IF;
  END IF;

  -- ─── Tâches bloquantes ───────────────────────────────────────────────
  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';

  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Tâches bloquantes ouvertes (%) sur la phase %', v_blocking_count, v_project.current_phase;
  END IF;

  -- Avancement effectif
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
    SELECT p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  -- Paiements jalonnés
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

  -- Enquêtes
  v_survey_phase := NULL;
  IF p_new_phase = 'design' THEN v_survey_phase := 'sourcing';
  ELSIF p_new_phase = 'travaux' THEN v_survey_phase := 'design';
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
