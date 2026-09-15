-- ============================================================================
-- 09 — Fonctions RPC métier critiques
-- ============================================================================

-- ─── advance_project_phase ──────────────────────────────────────────────────
-- Avance un projet à une nouvelle phase de manière atomique :
--   1. Vérifie la transition autorisée
--   2. Vérifie qu'aucune tâche bloquante n'est ouverte
--   3. Ferme la phase courante dans phases_history
--   4. Met à jour projects.current_phase
--   5. Ouvre une nouvelle ligne phases_history
--   6. Crée les tâches issues des templates
--   7. Crée les paiements automatiques
CREATE OR REPLACE FUNCTION advance_project_phase(
  p_project_id UUID,
  p_new_phase project_phase
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project projects;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
  v_payment_amount NUMERIC(14,2);
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
    SET current_phase = p_new_phase,
        updated_at = now()
    WHERE id = p_project_id;

  -- Ouvre nouvelle ligne phase_history
  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, p_new_phase, now());

  -- Crée les tâches depuis les templates
  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT
      p_project_id,
      t.id,
      t.phase,
      t.title,
      t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking,
      true,
      'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  -- Crée les paiements automatiques
  IF p_new_phase = 'sourcing' AND v_project.stoniz_fees_final > 0 THEN
    v_payment_amount := ROUND((v_project.stoniz_fees_final - 3000) * 0.5, 2);
    IF v_payment_amount > 0 THEN
      INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
        VALUES (p_project_id, 'honoraires_compromis', v_payment_amount, 'sourcing', CURRENT_DATE + 30);
    END IF;
  ELSIF p_new_phase = 'livraison' AND v_project.stoniz_fees_final > 0 THEN
    -- Solde = stoniz_fees_final - 3000€ acompte - honoraires_compromis déjà créés
    v_payment_amount := v_project.stoniz_fees_final - 3000
      - COALESCE((SELECT SUM(amount_expected) FROM payments
                  WHERE project_id = p_project_id AND type = 'honoraires_compromis'
                    AND deleted_at IS NULL), 0);
    IF v_payment_amount > 0 THEN
      INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
        VALUES (p_project_id, 'honoraires_livraison', v_payment_amount, 'livraison', CURRENT_DATE);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_phase', p_new_phase);
END;
$$;

-- ─── Trigger : créer l'acompte 3 000€ + phase onboarding au INSERT ──────────
CREATE OR REPLACE FUNCTION init_new_project() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Crée la phase onboarding
  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (NEW.id, 'onboarding', NEW.created_at);

  -- Crée le paiement acompte Stoniz
  INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
    VALUES (NEW.id, 'acompte_stoniz', 3000, 'onboarding', CURRENT_DATE);

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

CREATE TRIGGER projects_init_after_insert
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION init_new_project();

-- ─── respond_to_proposal ────────────────────────────────────────────────────
-- Réponse atomique à une proposition : évite la course critique entre clients
CREATE OR REPLACE FUNCTION respond_to_proposal(
  p_proposal_id UUID,
  p_response TEXT,
  p_refusal_reason TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_proposal property_proposals;
  v_property properties;
BEGIN
  IF p_response NOT IN ('accepted','refused','more_info') THEN
    RAISE EXCEPTION 'Réponse invalide: %', p_response;
  END IF;

  -- Verrouille la proposition
  SELECT * INTO v_proposal FROM property_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition introuvable';
  END IF;
  IF v_proposal.client_response <> 'pending' THEN
    RAISE EXCEPTION 'Proposition déjà traitée';
  END IF;

  -- Verrouille la property
  SELECT * INTO v_property FROM properties WHERE id = v_proposal.property_id FOR UPDATE;

  -- Met à jour la proposition
  UPDATE property_proposals
    SET client_response = p_response,
        client_response_at = now(),
        client_refusal_reason = p_refusal_reason,
        client_message = p_message
    WHERE id = p_proposal_id;

  IF p_response = 'accepted' THEN
    IF v_property.status IN ('vendu','offre') THEN
      RAISE EXCEPTION 'Ce bien a déjà été attribué à un autre projet';
    END IF;

    -- Marquer comme "offre" (passage à "vendu" se fait à la signature compromis)
    UPDATE properties SET status = 'offre' WHERE id = v_property.id;
    UPDATE projects
      SET property_id = v_property.id,
          nb_properties_accepted = nb_properties_accepted + 1
      WHERE id = v_proposal.project_id;

    -- Annuler les autres propositions du même bien encore en pending
    UPDATE property_proposals
      SET client_response = 'refused',
          client_response_at = now(),
          client_refusal_reason = 'Bien attribué à un autre projet'
      WHERE property_id = v_property.id
        AND id <> p_proposal_id
        AND client_response = 'pending';

  ELSIF p_response = 'refused' THEN
    -- NE PAS changer le statut global du bien
    UPDATE projects
      SET nb_properties_refused = nb_properties_refused + 1
      WHERE id = v_proposal.project_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'response', p_response,
    'property_id', v_property.id
  );
END;
$$;

-- ─── send_proposal ──────────────────────────────────────────────────────────
-- Création d'une proposition avec snapshot complet
CREATE OR REPLACE FUNCTION send_proposal(
  p_project_id UUID,
  p_property_id UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_property properties;
  v_proposal_id UUID;
  v_property_snap JSONB;
  v_financial_snap JSONB;
  v_media JSONB;
BEGIN
  SELECT * INTO v_property FROM properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_property.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bien introuvable';
  END IF;
  IF v_property.status NOT IN ('disponible','propose') THEN
    RAISE EXCEPTION 'Ce bien n''est pas disponible (statut: %)', v_property.status;
  END IF;

  -- Récupère les médias pour le snapshot
  SELECT jsonb_agg(jsonb_build_object('type', type, 'storage_path', storage_path, 'is_cover', is_cover))
    INTO v_media
    FROM property_media
    WHERE property_id = p_property_id
    ORDER BY display_order;

  v_property_snap := jsonb_build_object(
    'id', v_property.id,
    'name', v_property.name,
    'quartier', v_property.quartier,
    'type', v_property.type,
    'superficie', v_property.superficie,
    'nb_suites', v_property.nb_suites,
    'floor', v_property.floor,
    'media', COALESCE(v_media, '[]'::jsonb)
  );

  v_financial_snap := jsonb_build_object(
    'price', v_property.price,
    'agency_fees', COALESCE(v_property.agency_fees, ROUND(v_property.price * 0.08, 2)),
    'notary_fees', COALESCE(v_property.notary_fees, ROUND(v_property.price * 0.07, 2)),
    'estimated_rent', v_property.estimated_rent,
    'gross_yield', CASE WHEN v_property.price > 0 AND v_property.estimated_rent IS NOT NULL
      THEN ROUND((v_property.estimated_rent * 12) / v_property.price * 100, 2)
      ELSE NULL END
  );

  -- Insertion
  INSERT INTO property_proposals (project_id, property_id, sent_by, property_snapshot, financial_snapshot)
    VALUES (p_project_id, p_property_id, auth.uid(), v_property_snap, v_financial_snap)
    RETURNING id INTO v_proposal_id;

  -- Marque le bien comme "propose" si pas déjà
  IF v_property.status = 'disponible' THEN
    UPDATE properties SET status = 'propose' WHERE id = p_property_id;
  END IF;

  -- Incrémente le compteur projet
  UPDATE projects
    SET nb_properties_presented = nb_properties_presented + 1
    WHERE id = p_project_id;

  RETURN jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
END;
$$;
