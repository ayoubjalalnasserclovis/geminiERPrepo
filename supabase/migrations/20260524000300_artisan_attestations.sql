-- ============================================================================
-- Documents lies a un artisan : attestation regularite fiscale + attestation RIB
-- ============================================================================

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'devis_artisan','facture_artisan',
    'devis_fournisseur','facture_fournisseur','bon_commande',
    'attestation_regularite_fiscale','attestation_rib','attestation_cnss','attestation_assurance',
    'autre'
  ));

-- RLS : autoriser le staff a INSERT/SELECT/DELETE des documents lies a un artisan
-- (artisan_id present, project_id NULL) sans passer par client/project
DROP POLICY IF EXISTS documents_artisan_staff ON documents;
CREATE POLICY documents_artisan_staff ON documents
  FOR ALL
  USING (
    artisan_id IS NOT NULL
    AND is_staff(ARRAY['ceo','chef_projet','finance','assistante'])
  )
  WITH CHECK (
    artisan_id IS NOT NULL
    AND is_staff(ARRAY['ceo','chef_projet','finance','assistante'])
  );

-- Permet d'avoir des documents rattaches uniquement a un artisan (sans projet ni client)
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_check;
ALTER TABLE documents ADD CONSTRAINT documents_check
  CHECK (project_id IS NOT NULL OR client_id IS NOT NULL OR artisan_id IS NOT NULL);
