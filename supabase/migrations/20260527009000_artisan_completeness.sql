-- ============================================================================
-- Conformité fiche artisan pour paiements :
--   • business_scope : travaux / deco / both — filtre les spécialités
--   • attestation_rib, attestation_regularite_fiscale : nouveaux types doc
--     obligatoires pour les entreprises (pas pour auto-entrepreneurs / personnes physiques)
-- ============================================================================

-- 1. Scope d'activité de l'artisan / entreprise
ALTER TABLE artisans
  ADD COLUMN IF NOT EXISTS business_scope TEXT
  CHECK (business_scope IN ('travaux','deco','both'))
  DEFAULT 'travaux';

UPDATE artisans SET business_scope = COALESCE(business_scope, 'travaux');

-- 2. Élargir la liste des spécialités pour inclure les catégories déco
ALTER TABLE artisans DROP CONSTRAINT IF EXISTS artisans_speciality_check;
ALTER TABLE artisans
  ADD CONSTRAINT artisans_speciality_check CHECK (
    speciality IS NULL OR speciality IN (
      -- Travaux
      'demolition_cloisons','gros_oeuvre_maconnerie','electricite','plomberie_sanitaire',
      'carrelage_revetements','menuiserie_interieure','menuiserie_aluminium',
      'peinture','faux_plafond','climatisation_vmc','ferronnerie',
      'amenagements_exterieurs','cuisine','divers','multi_corps_etat',
      -- Déco / mobilier
      'mobilier_salon','mobilier_chambre','mobilier_sdb','mobilier_cuisine',
      'electromenager','luminaire','textile_decoration','vaisselle_arts_table',
      'linge_maison','plomberie_robinetterie','sanitaires','carrelage_marbre',
      'jardinage_exterieur'
    )
  );

-- 3. Ajouter les types de documents administratifs artisans au check global
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_type_check CHECK (type IN (
    'cahier_des_charges',
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'plan_bet','devis_travaux',
    'devis_artisan','facture_artisan',
    'attestation_rib','attestation_regularite_fiscale',
    'attestation_cnss','attestation_assurance',
    'preuve_virement',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'autre'
  ));

-- 4. Vue d'agrégation : artisans incomplets pour paiement
--    Critères :
--      - bank_name OU rib manquant → incomplet (toujours)
--      - ET pour les entreprises (legal_form NOT IN auto_entrepreneur / personne_physique) :
--          attestation_rib uploadée + attestation_regularite_fiscale uploadée
CREATE OR REPLACE VIEW artisans_completeness AS
SELECT
  a.id,
  a.name,
  a.type,
  a.legal_form,
  a.business_scope,
  a.bank_name,
  a.rib,
  (a.legal_form IS NOT NULL AND a.legal_form IN ('auto_entrepreneur','personne_physique')) AS is_indep,
  EXISTS (
    SELECT 1 FROM documents d
    WHERE d.artisan_id = a.id AND d.type = 'attestation_rib' AND d.deleted_at IS NULL
  ) AS has_attestation_rib,
  EXISTS (
    SELECT 1 FROM documents d
    WHERE d.artisan_id = a.id AND d.type = 'attestation_regularite_fiscale' AND d.deleted_at IS NULL
  ) AS has_attestation_fiscale,
  -- Liste des champs/docs manquants pour paiement (string[])
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(NULLIF(TRIM(a.bank_name), ''), NULL) IS NULL THEN 'bank_name' END,
    CASE WHEN COALESCE(NULLIF(TRIM(a.rib), ''), NULL) IS NULL THEN 'rib' END,
    CASE WHEN
      (a.legal_form IS NULL OR a.legal_form NOT IN ('auto_entrepreneur','personne_physique'))
      AND NOT EXISTS (
        SELECT 1 FROM documents d
        WHERE d.artisan_id = a.id AND d.type = 'attestation_rib' AND d.deleted_at IS NULL
      )
    THEN 'attestation_rib' END,
    CASE WHEN
      (a.legal_form IS NULL OR a.legal_form NOT IN ('auto_entrepreneur','personne_physique'))
      AND NOT EXISTS (
        SELECT 1 FROM documents d
        WHERE d.artisan_id = a.id AND d.type = 'attestation_regularite_fiscale' AND d.deleted_at IS NULL
      )
    THEN 'attestation_regularite_fiscale' END
  ], NULL) AS missing_for_payment
FROM artisans a
WHERE a.deleted_at IS NULL;

GRANT SELECT ON artisans_completeness TO authenticated;

-- 5. Fonction utilitaire appelable depuis l'app pour bloquer un paiement
--    Renvoie un texte d'erreur si la fiche n'est pas complète, sinon NULL.
CREATE OR REPLACE FUNCTION check_artisan_payment_ready(p_artisan_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT missing_for_payment INTO v_missing
  FROM artisans_completeness
  WHERE id = p_artisan_id;

  IF v_missing IS NULL OR array_length(v_missing, 1) IS NULL THEN
    RETURN NULL;  -- complet
  END IF;

  RETURN 'Fiche artisan incomplète pour paiement. Manquant : ' || array_to_string(v_missing, ', ');
END;
$$;
