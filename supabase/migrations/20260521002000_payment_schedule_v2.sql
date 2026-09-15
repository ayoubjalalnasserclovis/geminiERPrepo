-- ============================================================================
-- Update échéancier honoraires : 5 milestones à montants fixes
-- + déplacement de travaux_budget_estimate sur properties
-- ============================================================================

-- ─── 1. Ajout des nouveaux types de paiement ────────────────────────────────
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check
  CHECK (type IN (
    'acompte_stoniz',
    'honoraires_compromis',
    'honoraires_3d',
    'honoraires_chantier',
    'honoraires_livraison',
    'autre'
  ));

-- ─── 2. Budget travaux estimé sur le bien ───────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS travaux_budget_estimate NUMERIC(14,2);

COMMENT ON COLUMN properties.travaux_budget_estimate IS
  'Budget travaux estimé pour ce bien (EUR). Sert de référence pour la simulation projet.';

-- ─── 3. Mise à jour init_new_project : acompte 5 000 € (au lieu de 3 000 €) ─
CREATE OR REPLACE FUNCTION init_new_project() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Crée la phase onboarding
  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (NEW.id, 'onboarding', NEW.created_at);

  -- Crée le paiement acompte Stoniz (5 000 € fixe)
  INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
    VALUES (NEW.id, 'acompte_stoniz', 5000, 'onboarding', CURRENT_DATE);

  -- Crée les tâches de la phase onboarding
  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated)
    SELECT
      NEW.id,
      t.id,
      t.phase,
      t.title,
      t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking,
      true
    FROM task_templates t
    WHERE t.phase = 'onboarding' AND t.is_active = true
    ORDER BY t.order_index;

  RETURN NEW;
END;
$$;

-- ─── 4. Mise à jour advance_project_phase : nouveaux paiements par phase ────
CREATE OR REPLACE FUNCTION advance_project_phase(
  p_project_id UUID,
  p_new_phase project_phase
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project projects;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
BEGIN
  -- Verrouille le projet
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  -- Vérifie la transition (machine d'états)
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

  -- Vérifie l'absence de tâches bloquantes ouvertes
  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';

  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Tâches bloquantes ouvertes (%) sur la phase %', v_blocking_count, v_project.current_phase;
  END IF;

  -- Ferme la phase courante
  UPDATE project_phases_history
    SET completed_at = now(), completed_by = v_user_id
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND completed_at IS NULL;

  -- Met à jour le projet
  UPDATE projects
    SET current_phase = p_new_phase, updated_at = now()
    WHERE id = p_project_id;

  -- Ouvre nouvelle ligne phase_history
  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, p_new_phase, now());

  -- Crée les tâches depuis les templates
  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT
      p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  -- Nouvel échéancier : 4 paiements supplémentaires aux phases sourcing/design/travaux/livraison
  -- (l'acompte 5 000 € a été créé à la création du projet)
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

  RETURN jsonb_build_object('ok', true, 'new_phase', p_new_phase);
END;
$$;
