-- ============================================================================
-- Un bien retenu pour un client n'est plus disponible pour les autres.
--
-- Problème corrigé : select_final_property ne refusait que les biens "vendu".
-- Un bien déjà RETENU (status 'offre' + lié à un autre projet actif) passait la
-- vérification puis se faisait rejeter tout au fond par l'index unique
-- `projects_property_active_uniq` → message technique illisible côté UI
-- ("duplicate key value violates unique constraint …").
--
-- On ajoute une garde explicite, en amont, qui reproduit la condition de l'index
-- unique et lève un message clair et lisible par l'équipe. La règle métier
-- ("un bien = un seul projet vivant") reste garantie par l'index ; ici on la
-- rend simplement compréhensible.
-- ============================================================================

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

  -- ─── GARDE : le bien est-il déjà retenu pour un AUTRE projet vivant ? ──────
  -- Reproduit la condition de l'index unique projects_property_active_uniq, pour
  -- renvoyer un message clair AVANT que l'index ne lève une erreur technique.
  IF EXISTS (
    SELECT 1 FROM projects
    WHERE property_id = p_property_id
      AND id <> p_project_id
      AND deleted_at IS NULL
      AND status IN ('actif','termine')
  ) THEN
    RAISE EXCEPTION 'Ce bien est déjà retenu pour un autre client. Il n''est plus disponible : libérez-le d''abord depuis l''autre projet (Annuler la sélection) si nécessaire.';
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
