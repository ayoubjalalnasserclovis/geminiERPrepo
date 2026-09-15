-- ============================================================================
-- Update send_proposal pour inclure tous les champs de présentation
-- dans le snapshot envoyé au client.
-- ============================================================================

CREATE OR REPLACE FUNCTION send_proposal(
  p_project_id UUID,
  p_property_id UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property properties;
  v_proposal_id UUID;
  v_property_snap JSONB;
  v_financial_snap JSONB;
BEGIN
  SELECT * INTO v_property FROM properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_property.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bien introuvable';
  END IF;
  IF v_property.status NOT IN ('disponible','propose') THEN
    RAISE EXCEPTION 'Ce bien n''est pas disponible (statut: %)', v_property.status;
  END IF;

  -- Snapshot complet du bien (toutes les colonnes via to_jsonb)
  v_property_snap := to_jsonb(v_property);

  -- Snapshot financier dérivé
  v_financial_snap := jsonb_build_object(
    'price', v_property.price,
    'agency_fees', COALESCE(v_property.agency_fees, ROUND(v_property.price * 0.08, 2)),
    'notary_fees', COALESCE(v_property.notary_fees, ROUND(v_property.price * 0.07, 2)),
    'travaux_budget_estimate', v_property.travaux_budget_estimate,
    'estimated_rent', v_property.estimated_rent,
    'revenu_locatif_brut_annuel', v_property.revenu_locatif_brut_annuel,
    'taux_occupation', v_property.taux_occupation,
    'frais_fonctionnement_annuel', v_property.frais_fonctionnement_annuel,
    'conciergerie_annuel', v_property.conciergerie_annuel,
    'emprunt_mensuel', v_property.emprunt_mensuel,
    'impots_annuel', v_property.impots_annuel
  );

  INSERT INTO property_proposals (project_id, property_id, sent_by, property_snapshot, financial_snapshot)
    VALUES (p_project_id, p_property_id, auth.uid(), v_property_snap, v_financial_snap)
    RETURNING id INTO v_proposal_id;

  IF v_property.status = 'disponible' THEN
    UPDATE properties SET status = 'propose' WHERE id = p_property_id;
  END IF;

  UPDATE projects
    SET nb_properties_presented = nb_properties_presented + 1
    WHERE id = p_project_id;

  RETURN jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
END;
$$;
