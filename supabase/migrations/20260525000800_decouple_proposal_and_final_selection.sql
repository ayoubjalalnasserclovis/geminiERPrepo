-- ============================================================================
-- Découplage : "accepted" par le client = juste interesse, pas de binding au projet.
-- Une fonction dediee `select_final_property` lie le bien au projet (etape ultime,
-- declenchee par le chef de projet apres validation client).
-- Le gate de phase (Design exige property_id) reste inchange.
-- ============================================================================

-- ─── 1. Flag sur la proposition : "retenue comme bien final" ────────────────
ALTER TABLE property_proposals
  ADD COLUMN IF NOT EXISTS selected_as_final_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_by UUID REFERENCES profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS property_proposals_one_final_per_project
  ON property_proposals (project_id)
  WHERE selected_as_final_at IS NOT NULL;

COMMENT ON COLUMN property_proposals.selected_as_final_at IS
  'Date de selection definitive du bien comme bien du projet (apres validation client).';

-- ─── 2. Refactor respond_to_proposal : accepted = interesse uniquement ────
CREATE OR REPLACE FUNCTION respond_to_proposal(
  p_proposal_id UUID,
  p_response TEXT,
  p_refusal_reason TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal property_proposals;
BEGIN
  IF p_response NOT IN ('accepted','refused','more_info') THEN
    RAISE EXCEPTION 'Réponse invalide: %', p_response;
  END IF;

  SELECT * INTO v_proposal FROM property_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition introuvable';
  END IF;
  IF v_proposal.client_response <> 'pending' THEN
    RAISE EXCEPTION 'Proposition déjà traitée';
  END IF;

  UPDATE property_proposals
    SET client_response = p_response,
        client_response_at = now(),
        client_refusal_reason = p_refusal_reason,
        client_message = p_message
    WHERE id = p_proposal_id;

  -- Compteurs sur le projet (utiles pour les KPIs)
  IF p_response = 'accepted' THEN
    UPDATE projects
      SET nb_properties_accepted = nb_properties_accepted + 1
      WHERE id = v_proposal.project_id;
  ELSIF p_response = 'refused' THEN
    UPDATE projects
      SET nb_properties_refused = nb_properties_refused + 1
      WHERE id = v_proposal.project_id;
  END IF;

  -- NOTE : on ne touche plus a properties.status ni a projects.property_id ici.
  -- Le chef de projet doit appeler select_final_property() apres validation finale.

  RETURN jsonb_build_object(
    'ok', true,
    'response', p_response,
    'proposal_id', p_proposal_id
  );
END;
$$;

-- ─── 3. select_final_property : sélection définitive par le chef de projet ──
CREATE OR REPLACE FUNCTION select_final_property(
  p_project_id UUID,
  p_property_id UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects;
  v_property properties;
  v_proposal property_proposals;
  v_user_id UUID := auth.uid();
BEGIN
  -- Verrouille le projet
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  IF v_project.property_id IS NOT NULL AND v_project.property_id <> p_property_id THEN
    RAISE EXCEPTION 'Un bien est déjà sélectionné comme bien final pour ce projet. Annulez la sélection précédente pour en choisir un autre.';
  END IF;

  -- Verrouille le bien
  SELECT * INTO v_property FROM properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_property.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bien introuvable';
  END IF;
  IF v_property.status IN ('vendu') THEN
    RAISE EXCEPTION 'Ce bien est déjà vendu sur un autre projet';
  END IF;

  -- Vérifie qu'une proposition pour ce projet+bien existe et a été acceptée
  SELECT * INTO v_proposal
    FROM property_proposals
    WHERE project_id = p_project_id
      AND property_id = p_property_id
      AND client_response = 'accepted'
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce bien n''a pas été accepté par le client comme proposition. Le client doit d''abord exprimer son intérêt depuis son portail.';
  END IF;

  -- Lie le bien au projet
  UPDATE projects
    SET property_id = p_property_id, updated_at = now()
    WHERE id = p_project_id;

  -- Statut du bien -> offre (passera a "vendu" a la signature compromis)
  UPDATE properties SET status = 'offre' WHERE id = p_property_id;

  -- Marque la proposition retenue
  UPDATE property_proposals
    SET selected_as_final_at = now(), selected_by = v_user_id
    WHERE id = v_proposal.id;

  -- Annule les autres propositions EN ATTENTE pour ce projet (les "accepted" restent)
  UPDATE property_proposals
    SET client_response = 'refused',
        client_response_at = now(),
        client_refusal_reason = 'Un autre bien a été sélectionné pour ce projet'
    WHERE project_id = p_project_id
      AND id <> v_proposal.id
      AND client_response = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'property_id', p_property_id,
    'proposal_id', v_proposal.id
  );
END;
$$;

-- ─── 4. unselect_final_property : annule la sélection (chef de projet/CEO) ──
CREATE OR REPLACE FUNCTION unselect_final_property(p_project_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;
  IF v_project.property_id IS NULL THEN
    RAISE EXCEPTION 'Aucun bien sélectionné';
  END IF;

  -- Reset projet
  UPDATE projects SET property_id = NULL, updated_at = now() WHERE id = p_project_id;

  -- Libere le bien (s'il etait en "offre" a cause de cette selection)
  UPDATE properties
    SET status = CASE WHEN status = 'offre' THEN 'disponible' ELSE status END
    WHERE id = v_project.property_id;

  -- Decoche la proposition finale
  UPDATE property_proposals
    SET selected_as_final_at = NULL, selected_by = NULL
    WHERE project_id = p_project_id AND selected_as_final_at IS NOT NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;
