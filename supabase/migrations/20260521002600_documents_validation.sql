-- ============================================================================
-- Ajout : type "lots_techniques" + flux de validation client sur documents
-- ============================================================================

-- ─── 1. Ajout du type "lots_techniques" ─────────────────────────────────────
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','permis_travaux',
    'photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'autre'
  ));

-- ─── 2. Colonnes de validation client ───────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS requires_client_validation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_validation_status TEXT
    CHECK (client_validation_status IN ('pending','validated','refused','more_info')),
  ADD COLUMN IF NOT EXISTS client_validation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_validation_comment TEXT;

COMMENT ON COLUMN documents.requires_client_validation IS
  'Si true, le client doit valider/refuser ce document via son portail.';
COMMENT ON COLUMN documents.client_validation_status IS
  'État de la validation : pending, validated, refused, more_info.';

-- ─── 3. RLS : autoriser le client à UPDATE le statut de validation ─────────
-- Le client peut SEULEMENT mettre à jour les colonnes de validation,
-- et UNIQUEMENT sur les docs qui lui sont visibles + requièrent validation.
DROP POLICY IF EXISTS documents_client_validate ON documents;
CREATE POLICY documents_client_validate ON documents FOR UPDATE
  USING (
    project_id IN (SELECT client_project_ids())
    AND is_visible_to_client = true
    AND requires_client_validation = true
    AND deleted_at IS NULL
  )
  WITH CHECK (
    project_id IN (SELECT client_project_ids())
    AND is_visible_to_client = true
    AND requires_client_validation = true
    AND deleted_at IS NULL
  );

-- ─── 4. Index pour les requêtes filtrées ────────────────────────────────────
CREATE INDEX IF NOT EXISTS documents_pending_validation_idx
  ON documents (project_id)
  WHERE requires_client_validation = true
    AND client_validation_status = 'pending'
    AND deleted_at IS NULL;
