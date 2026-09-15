ALTER TABLE property_proposals
  ADD COLUMN IF NOT EXISTS selected_as_final_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_by UUID REFERENCES profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS property_proposals_one_final_per_project
  ON property_proposals (project_id)
  WHERE selected_as_final_at IS NOT NULL;

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

  IF p_response = 'accepted' THEN
    UPDATE projects SET nb_properties_accepted = nb_properties_accepted + 1
      WHERE id = v_proposal.project_id;
  ELSIF p_response = 'refused' THEN
    UPDATE projects SET nb_properties_refused = nb_properties_refused + 1
      WHERE id = v_proposal.project_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'response', p_response, 'proposal_id', p_proposal_id);
END;
$$;

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
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Projet introuvable'; END IF;
  IF v_project.property_id IS NOT NULL AND v_project.property_id <> p_property_id THEN
    RAISE EXCEPTION 'Un bien est déjà sélectionné comme bien final pour ce projet.';
  END IF;

  SELECT * INTO v_property FROM properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_property.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Bien introuvable'; END IF;
  IF v_property.status = 'vendu' THEN
    RAISE EXCEPTION 'Ce bien est déjà vendu sur un autre projet';
  END IF;

  SELECT * INTO v_proposal FROM property_proposals
    WHERE project_id = p_project_id AND property_id = p_property_id AND client_response = 'accepted'
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce bien n''a pas été accepté par le client.';
  END IF;

  UPDATE projects SET property_id = p_property_id, updated_at = now() WHERE id = p_project_id;
  UPDATE properties SET status = 'offre' WHERE id = p_property_id;
  UPDATE property_proposals SET selected_as_final_at = now(), selected_by = v_user_id WHERE id = v_proposal.id;
  UPDATE property_proposals SET client_response = 'refused', client_response_at = now(),
      client_refusal_reason = 'Un autre bien a été sélectionné pour ce projet'
    WHERE project_id = p_project_id AND id <> v_proposal.id AND client_response = 'pending';

  RETURN jsonb_build_object('ok', true, 'project_id', p_project_id, 'property_id', p_property_id);
END;
$$;

CREATE OR REPLACE FUNCTION unselect_final_property(p_project_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project projects;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Projet introuvable'; END IF;
  IF v_project.property_id IS NULL THEN RAISE EXCEPTION 'Aucun bien sélectionné'; END IF;

  UPDATE projects SET property_id = NULL, updated_at = now() WHERE id = p_project_id;
  UPDATE properties SET status = CASE WHEN status = 'offre' THEN 'disponible' ELSE status END
    WHERE id = v_project.property_id;
  UPDATE property_proposals SET selected_as_final_at = NULL, selected_by = NULL
    WHERE project_id = p_project_id AND selected_as_final_at IS NOT NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

NOTIFY pgrst, 'reload schema';