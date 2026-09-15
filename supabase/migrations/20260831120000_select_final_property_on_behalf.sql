-- Feature CEO 2026-08-31 : le chef de projet peut valider un bien AU NOM du client
-- quand ce dernier est indisponible (vacances, no-show WhatsApp, etc.).
--
-- Contexte : aujourd'hui `select_final_property` exige que la proposition ait
-- ete `client_response = 'accepted'` par le client depuis son portail. Si le
-- client est injoignable, le projet reste bloque en sourcing. Cette RPC parallele
-- permet au CP de valider avec justification obligatoire, tout en marquant
-- explicitement que c'est une validation par procuration (banniere ambre sur
-- fiche projet + audit log).
--
-- Migration deja appliquee en prod le 2026-08-31 via apply_migration MCP.

ALTER TABLE public.property_proposals
  ADD COLUMN IF NOT EXISTS selected_on_behalf boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_on_behalf_reason text;

COMMENT ON COLUMN public.property_proposals.selected_on_behalf IS
  'Vrai si le chef de projet a valide ce bien au nom du client (indisponibilite). CEO 2026-08-31.';
COMMENT ON COLUMN public.property_proposals.selected_on_behalf_reason IS
  'Motif obligatoire de la validation par procuration (ex : client en vacances jusqu au 5/09).';

CREATE OR REPLACE FUNCTION public.select_final_property_on_behalf(
  p_project_id uuid,
  p_property_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project projects;
  v_property properties;
  v_proposal property_proposals;
  v_user_id UUID := auth.uid();
BEGIN
  -- Validation du motif (double check en base + coté app)
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Le motif de validation par procuration doit contenir au moins 10 caracteres.';
  END IF;

  -- Verrouille le projet
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  IF v_project.property_id IS NOT NULL AND v_project.property_id <> p_property_id THEN
    RAISE EXCEPTION 'Un bien est deja selectionne comme bien final pour ce projet. Annulez la selection precedente pour en choisir un autre.';
  END IF;

  -- Verrouille le bien
  SELECT * INTO v_property FROM properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_property.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bien introuvable';
  END IF;
  IF v_property.status IN ('vendu') THEN
    RAISE EXCEPTION 'Ce bien est deja vendu sur un autre projet';
  END IF;

  -- Le bien est-il deja pris pour un autre projet vivant ?
  IF EXISTS (
    SELECT 1 FROM projects
    WHERE property_id = p_property_id
      AND id <> p_project_id
      AND deleted_at IS NULL
      AND status IN ('actif','termine')
  ) THEN
    RAISE EXCEPTION 'Ce bien est deja retenu pour un autre client. Il n''est plus disponible : liberez-le d''abord depuis l''autre projet (Annuler la selection) si necessaire.';
  END IF;

  -- La proposition doit exister (le CP doit avoir envoye la proposition avant).
  -- Peu importe le client_response : on force accepted + flag on_behalf.
  SELECT * INTO v_proposal
    FROM property_proposals
    WHERE project_id = p_project_id
      AND property_id = p_property_id
    ORDER BY sent_at DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune proposition pour ce bien sur ce projet. Envoyez d''abord la proposition depuis le portail equipe.';
  END IF;

  -- Lie le bien au projet
  UPDATE projects
    SET property_id = p_property_id, updated_at = now()
    WHERE id = p_project_id;

  -- Statut du bien -> offre (passera a "vendu" a la signature compromis)
  UPDATE properties SET status = 'offre' WHERE id = p_property_id;

  -- Marque la proposition retenue AVEC flag on_behalf + reason.
  -- Force aussi client_response=accepted pour coherence avec le reste du flow
  -- (les UI/queries existantes reposent souvent sur ce champ).
  UPDATE property_proposals
    SET selected_as_final_at = now(),
        selected_by = v_user_id,
        selected_on_behalf = true,
        selected_on_behalf_reason = trim(p_reason),
        client_response = 'accepted',
        client_response_at = COALESCE(client_response_at, now()),
        client_refusal_reason = NULL,
        client_message = COALESCE(client_message, '[Validation par le chef de projet au nom du client]')
    WHERE id = v_proposal.id;

  -- Annule les autres propositions EN ATTENTE pour ce projet
  UPDATE property_proposals
    SET client_response = 'refused',
        client_response_at = now(),
        client_refusal_reason = 'Un autre bien a ete selectionne pour ce projet'
    WHERE project_id = p_project_id
      AND id <> v_proposal.id
      AND client_response = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'property_id', p_property_id,
    'proposal_id', v_proposal.id,
    'on_behalf', true
  );
END;
$function$;

COMMENT ON FUNCTION public.select_final_property_on_behalf(uuid, uuid, text) IS
  'Valide un bien final au nom du client (indisponibilite). Motif obligatoire ≥ 10 chars. Flag + reason stockes sur property_proposals pour banniere UI. CEO 2026-08-31.';
