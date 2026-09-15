-- ============================================================================
-- 1. Simplification des templates de tâches (onboarding + sourcing)
-- 2. Ajout colonnes properties : terrasse_m2, google_maps_url
-- 3. Validation : property_id requis pour passer sourcing → design
-- ============================================================================

-- ─── 1. Désactiver tous les anciens templates onboarding / sourcing ─────────
UPDATE task_templates
SET is_active = false
WHERE phase IN ('onboarding', 'sourcing');

-- ─── 2. Insérer les nouveaux templates onboarding (4 tâches) ────────────────
INSERT INTO task_templates (phase, title, default_assigned_role, order_index, is_blocking, is_active)
VALUES
  ('onboarding', 'Collecter la pièce d''identité',    'assistante',  10, true,  true),
  ('onboarding', 'Ajouter le contrat de mission',     'commercial',  20, true,  true),
  ('onboarding', 'Compléter le cahier des charges',   'commercial',  30, true,  true),
  ('onboarding', 'Encaisser acompte Stoniz (5 000 €)','finance',     40, true,  true);

-- ─── 3. Insérer les nouveaux templates sourcing (3 tâches) ──────────────────
INSERT INTO task_templates (phase, title, default_assigned_role, order_index, is_blocking, is_active)
VALUES
  ('sourcing', 'Rédiger et envoyer l''offre d''achat',     'chef_projet', 10, true, true),
  ('sourcing', 'Organiser le RDV chez le notaire',          'chef_projet', 20, true, true),
  ('sourcing', 'Encaisser les honoraires Stoniz (3 800 €)', 'finance',     30, true, true);

-- ─── 4. Nouvelles colonnes properties ───────────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS terrasse_m2 NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

COMMENT ON COLUMN properties.terrasse_m2 IS 'Surface de la terrasse en m².';
COMMENT ON COLUMN properties.google_maps_url IS 'Lien Google Maps direct vers la propriété.';

-- ─── 5. Renforcement advance_project_phase ─────────────────────────────────
-- Le passage sourcing → design exige qu'un bien soit validé sur le projet.
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

  -- NOUVEAU : passage sourcing → design exige un bien validé
  IF v_project.current_phase = 'sourcing' AND p_new_phase = 'design' THEN
    IF v_project.property_id IS NULL THEN
      RAISE EXCEPTION 'Impossible de passer en phase Design : aucun bien n''est encore validé pour ce projet';
    END IF;
  END IF;

  -- Vérification des tâches bloquantes
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

  -- Paiements automatiques par phase
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
