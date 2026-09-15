-- ============================================================================
-- Photos projet — table centralisée polymorphique
-- ============================================================================
-- Remplace les colonnes `photo_paths TEXT[]` éparpillées sur plusieurs tables
-- (vct_action, pv_reserve, vct_item, pv_item, intervention...) par UNE table
-- unique avec :
--   - association polymorphique (entity_type + entity_id)
--   - audit trail complet (qui, quand, IP, UA, hash)
--   - catégorie sémantique (before/after/verified/defaut/reference)
--   - métadonnées (dimensions, MIME, taille, caption, ordre)
--   - soft delete
--
-- Avantages :
--   - Une seule logique d'upload/affichage pour tout le projet
--   - Galerie projet = SELECT * FROM project_photos WHERE project_id = X
--   - Audit conforme RGPD + valeur juridique
--   - Dédup possible via hash SHA-256
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Association polymorphique
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'vct_action',     -- action corrective VCT
    'pv_reserve',     -- réserve PV
    'vct_item',       -- item checklist VCT
    'pv_item',        -- item checklist PV
    'intervention',   -- intervention Propria
    'project'         -- photo générale projet
  )),
  entity_id UUID NOT NULL,

  -- Catégorie sémantique du moment de prise de vue
  kind TEXT NOT NULL CHECK (kind IN (
    'before',     -- état du défaut avant correction
    'after',      -- état après correction (preuve)
    'verified',   -- contre-vérification chef projet
    'defaut',     -- défaut constaté simple (sans avant/après)
    'reference'   -- photo de référence / contexte
  )),

  -- Storage Supabase
  storage_path TEXT NOT NULL UNIQUE,
  hash_sha256 TEXT,                          -- pour dédup
  file_size_bytes BIGINT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,

  -- Audit trail (juridique + RGPD)
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES profiles(id),
  uploaded_ip TEXT,
  uploaded_user_agent TEXT,

  -- Métadonnées éditoriales
  caption TEXT,                              -- libellé / description optionnel
  display_order INTEGER NOT NULL DEFAULT 0,
  watermark_applied BOOLEAN NOT NULL DEFAULT false,

  -- Soft delete
  deleted_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index optimisés pour les requêtes courantes
CREATE INDEX IF NOT EXISTS project_photos_entity_idx
  ON project_photos (entity_type, entity_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_photos_project_idx
  ON project_photos (project_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_photos_hash_idx
  ON project_photos (hash_sha256)
  WHERE hash_sha256 IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_photos_kind_idx
  ON project_photos (entity_id, kind, display_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER project_photos_updated_at BEFORE UPDATE ON project_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Migration douce des données existantes
-- ============================================================================
-- Pour chaque ligne avec photo_paths non vide, on crée un row par photo
-- avec kind='after' (la donnée historique est ambiguë, on prend la sémantique
-- la plus probable : photos déjà uploadées = preuves de correction)
-- ============================================================================

-- VCT actions
INSERT INTO project_photos (
  project_id, entity_type, entity_id, kind, storage_path, uploaded_at
)
SELECT
  a.project_id,
  'vct_action',
  a.id,
  'after',
  path,
  COALESCE(a.resolved_at, a.created_at)
FROM project_vct_corrective_actions a
CROSS JOIN LATERAL unnest(COALESCE(a.photo_paths, '{}')) AS path
WHERE a.photo_paths IS NOT NULL AND array_length(a.photo_paths, 1) > 0;

-- VCT items (si jamais des photos avaient été uploadées)
INSERT INTO project_photos (
  project_id, entity_type, entity_id, kind, storage_path, uploaded_at
)
SELECT
  (SELECT project_id FROM project_vct WHERE id = vi.vct_id),
  'vct_item',
  vi.id,
  'defaut',
  path,
  vi.created_at
FROM project_vct_items vi
CROSS JOIN LATERAL unnest(COALESCE(vi.photo_paths, '{}')) AS path
WHERE vi.photo_paths IS NOT NULL AND array_length(vi.photo_paths, 1) > 0
  AND EXISTS (SELECT 1 FROM project_vct WHERE id = vi.vct_id);

-- PV items
INSERT INTO project_photos (
  project_id, entity_type, entity_id, kind, storage_path, uploaded_at
)
SELECT
  (SELECT project_id FROM project_reception_pvs WHERE id = pi.pv_id),
  'pv_item',
  pi.id,
  'defaut',
  path,
  pi.created_at
FROM project_reception_pv_items pi
CROSS JOIN LATERAL unnest(COALESCE(pi.photo_paths, '{}')) AS path
WHERE pi.photo_paths IS NOT NULL AND array_length(pi.photo_paths, 1) > 0
  AND EXISTS (SELECT 1 FROM project_reception_pvs WHERE id = pi.pv_id);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE project_photos ENABLE ROW LEVEL SECURITY;

-- Staff read : tous les profils non-client
DROP POLICY IF EXISTS project_photos_staff_read ON project_photos;
CREATE POLICY project_photos_staff_read
  ON project_photos FOR SELECT
  USING (is_staff());

DROP POLICY IF EXISTS project_photos_staff_write ON project_photos;
CREATE POLICY project_photos_staff_write
  ON project_photos FOR INSERT
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','assistante','propria']));

DROP POLICY IF EXISTS project_photos_staff_update ON project_photos;
CREATE POLICY project_photos_staff_update
  ON project_photos FOR UPDATE
  USING (is_staff(ARRAY['ceo','chef_projet']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet']));

DROP POLICY IF EXISTS project_photos_staff_delete ON project_photos;
CREATE POLICY project_photos_staff_delete
  ON project_photos FOR DELETE
  USING (is_staff(ARRAY['ceo','chef_projet']));

-- Client : peut voir les photos liées à SON projet, sur les entités visibles côté client
-- (PV reserves, PV items uniquement — pas VCT qui est interne Stoniz)
DROP POLICY IF EXISTS project_photos_client_read ON project_photos;
CREATE POLICY project_photos_client_read
  ON project_photos FOR SELECT
  USING (
    entity_type IN ('pv_reserve','pv_item')
    AND project_id IN (
      SELECT id FROM projects WHERE client_id IN (
        SELECT id FROM clients WHERE profile_id = auth.uid()
      )
    )
  );

-- ============================================================================
-- Audit trigger
-- ============================================================================
DROP TRIGGER IF EXISTS audit_project_photos ON project_photos;
CREATE TRIGGER audit_project_photos
  AFTER INSERT OR UPDATE OR DELETE ON project_photos
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ============================================================================
-- Vue helper : photos avec leur entité parente résolue
-- (utile pour la galerie projet — affiche un libellé pour chaque photo)
-- ============================================================================
CREATE OR REPLACE VIEW project_photos_enriched AS
SELECT
  p.*,
  CASE p.entity_type
    WHEN 'vct_action' THEN (
      SELECT description FROM project_vct_corrective_actions WHERE id = p.entity_id
    )
    WHEN 'pv_reserve' THEN (
      SELECT description FROM project_reception_pv_reserves WHERE id = p.entity_id
    )
    WHEN 'vct_item' THEN (
      SELECT name FROM project_vct_items WHERE id = p.entity_id
    )
    WHEN 'pv_item' THEN (
      SELECT name FROM project_reception_pv_items WHERE id = p.entity_id
    )
    WHEN 'intervention' THEN (
      SELECT description FROM propria_interventions WHERE id = p.entity_id
    )
    ELSE NULL
  END AS entity_label
FROM project_photos p
WHERE p.deleted_at IS NULL;

ALTER VIEW project_photos_enriched SET (security_invoker = on);

COMMENT ON TABLE project_photos IS
  'Centralise toutes les photos liées à un projet (VCT, PV, interventions...) avec audit trail RGPD-compliant.';
COMMENT ON COLUMN project_photos.kind IS
  'Catégorie sémantique : before (état défaut), after (preuve correction), verified (contre-vérification), defaut (défaut simple), reference (contexte).';
COMMENT ON VIEW project_photos_enriched IS
  'Vue jointe avec le libellé de l''entité parente, utile pour la galerie projet.';
