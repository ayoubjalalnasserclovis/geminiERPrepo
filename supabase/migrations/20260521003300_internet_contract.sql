-- ============================================================================
-- Ajout : contrat internet (n° + document) — optionnel
-- ============================================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS internet_contract_number TEXT;

COMMENT ON COLUMN projects.internet_contract_number IS
  'Numéro de contrat internet/fibre — optionnel';

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list','permis_travaux',
    'photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'autre'
  ));
