-- ============================================================================
-- Session D (CEO 2026-08-19) — Retour d'étape + anti-doublon tâches + moodboard final
-- ============================================================================
-- 2.3 Cahier des charges : pouvoir revenir à l'étape précédente à tout moment
-- (erreur de manipulation), avec confirmation et traçabilité (qui, quand).
--
-- 1) revert_project_phase : recule le projet d'UNE étape (répétable).
--    - Rôles : ceo + chef_projet (décision CEO 2026-08-19) ; appel système OK.
--    - RIEN n'est supprimé : tâches, paiements, documents restent en place.
--    - Traçabilité via project_phases_history : la ligne ouverte de la phase
--      quittée est fermée (completed_at + completed_by = auteur du retour),
--      une nouvelle ligne s'ouvre sur la phase précédente. L'historique
--      complet des allers-retours est donc lisible tel quel.
--    - Projets perdus exclus (résurrection = flux lifecycle dédié).
--
-- 2) advance_project_phase RECRÉÉE À L'IDENTIQUE (version 20260623120000)
--    avec UNE correction : l'insert des tâches auto saute les templates déjà
--    instanciés sur le projet. Sans ça, revenir puis ré-avancer dupliquait
--    toutes les tâches de la phase (les paiements étaient déjà protégés par
--    upsert_milestone_payment depuis les incidents Boutira/Yassine).
--
-- 3) 2.6 : champs "Moodboard sélectionné" (choix FINAL retenu pour exécution)
--    sur projects — template du catalogue OU libellé libre, + qui/quand.
-- ============================================================================

-- ─── 1) RPC retour d'étape ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revert_project_phase(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $revertfn$
DECLARE
  v_project projects;
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_prev project_phase;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  -- Rôles autorisés (décision CEO 2026-08-19) ; auth.uid() NULL = appel système.
  IF v_user_id IS NOT NULL THEN
    SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
    IF COALESCE(v_role, '') NOT IN ('ceo', 'chef_projet') THEN
      RAISE EXCEPTION 'Retour d''étape réservé au CEO et au chef de projet.';
    END IF;
  END IF;

  IF v_project.status = 'perdu' THEN
    RAISE EXCEPTION 'Projet perdu — utiliser la résurrection lifecycle, pas le retour d''étape.';
  END IF;

  v_prev := CASE v_project.current_phase
    WHEN 'sourcing'         THEN 'onboarding'::project_phase
    WHEN 'design'           THEN 'sourcing'::project_phase
    WHEN 'travaux'          THEN 'design'::project_phase
    WHEN 'livraison'        THEN 'travaux'::project_phase
    WHEN 'mise_en_location' THEN 'livraison'::project_phase
    WHEN 'termine'          THEN 'mise_en_location'::project_phase
    ELSE NULL
  END;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'Le projet est déjà à la première étape (%).', v_project.current_phase;
  END IF;

  -- Ferme la ligne d'historique ouverte de la phase quittée (trace : qui, quand)
  UPDATE project_phases_history
    SET completed_at = now(), completed_by = v_user_id
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND completed_at IS NULL;

  UPDATE projects
    SET current_phase = v_prev, updated_at = now()
    WHERE id = p_project_id;

  -- Rouvre la phase précédente (nouvelle ligne : l'historique garde le va-et-vient)
  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, v_prev, now());

  RETURN jsonb_build_object(
    'ok', true,
    'reverted_from', v_project.current_phase,
    'new_phase', v_prev
  );
END;
$revertfn$;

COMMENT ON FUNCTION public.revert_project_phase(uuid) IS
  'Recule un projet d''une étape (ceo + chef_projet). Rien n''est supprimé ; traçabilité complète via project_phases_history. Posée le 2026-08-19 (session D roadmap évolutions).';

-- ─── 2) advance_project_phase : anti-doublon tâches à la ré-avancée ────────
CREATE OR REPLACE FUNCTION public.advance_project_phase(
  p_project_id uuid,
  p_new_phase  project_phase
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        -- CEO 2026-08-19 (session D, retour d'étape) : NE PAS recréer une tâche
        -- auto déjà présente pour ce template — sinon chaque retour+ré-avancée
        -- dupliquait toutes les tâches de la phase.
        AND NOT EXISTS (
          SELECT 1 FROM tasks x
          WHERE x.project_id = p_project_id AND x.template_id = t.id
        )
      ORDER BY t.order_index;

    -- Création des jalons de paiement via upsert_milestone_payment (idempotent + anti-doublon)
    -- Fix incidents Boutira (4200€ honoraires_livraison) + Yassine (3800€ honoraires_3d) du 18-19 juin 2026.
    IF p_new_phase = 'sourcing' THEN
      PERFORM upsert_milestone_payment(p_project_id, 'honoraires_compromis', 3800, CURRENT_DATE + 30, 'sourcing'::project_phase);
    ELSIF p_new_phase = 'design' THEN
      PERFORM upsert_milestone_payment(p_project_id, 'honoraires_3d', 3800, CURRENT_DATE + 14, 'design'::project_phase);
    ELSIF p_new_phase = 'travaux' THEN
      PERFORM upsert_milestone_payment(p_project_id, 'honoraires_chantier', 4200, CURRENT_DATE, 'travaux'::project_phase);
    ELSIF p_new_phase = 'livraison' THEN
      PERFORM upsert_milestone_payment(p_project_id, 'honoraires_livraison', 4200, CURRENT_DATE, 'livraison'::project_phase);
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
$function$;

COMMENT ON FUNCTION public.advance_project_phase(uuid, project_phase) IS
  'Avance un projet à la phase suivante. Tâches auto : templates déjà instanciés sautés (fix retour+ré-avancée, 2026-08-19). Paiements via upsert_milestone_payment (idempotent).';

-- ─── 3) Moodboard sélectionné (choix final retenu) ─────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS moodboard_final_template_id UUID REFERENCES moodboard_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moodboard_final_label TEXT,
  ADD COLUMN IF NOT EXISTS moodboard_final_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moodboard_final_decided_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN projects.moodboard_final_template_id IS
  'Moodboard FINAL retenu pour exécution (template du catalogue). Exclusif avec moodboard_final_label. Distinct des préférences client (client_moodboard_selections).';
COMMENT ON COLUMN projects.moodboard_final_label IS
  'Libellé libre du moodboard final si hors catalogue (ex : mix des templates 2 et 4, brief WhatsApp).';
COMMENT ON COLUMN projects.moodboard_final_decided_at IS 'Quand le choix final a été acté.';
COMMENT ON COLUMN projects.moodboard_final_decided_by IS 'Qui a acté le choix final (équipe).';
