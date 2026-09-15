-- ============================================================================
-- Ajout de types de documents manquants à la liste autorisée :
--   • devis_artisan / facture_artisan : utilisés par le module Travaux
--     pour rattacher les fichiers de devis/factures à un lot artisan
--   • preuve_virement : utilisé par le workflow de validation paiements
--     (action "Marquer comme payé" → upload preuve virement)
-- ============================================================================

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_type_check CHECK (type IN (
    'cahier_des_charges',
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'plan_bet','devis_travaux',
    'devis_artisan','facture_artisan',
    'preuve_virement',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'autre'
  ));
