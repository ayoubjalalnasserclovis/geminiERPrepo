-- ============================================================================
-- CEO 2026-06-18 — Régularisation des migrations appliquées via MCP
--
-- Ces 2 changements ont été appliqués en prod via mcp__supabase__apply_migration
-- aujourd'hui mais n'étaient pas dans le repo. Sans cette migration, un déploiement
-- clean (fresh DB) casserait. IDEMPOTENT (DROP/CREATE IF NOT EXISTS).
--
-- Contenu :
--   1. excluded_from_publication_checklist (chantier brouillons biens)
--   2. trigger properties_autopublish_on_aval (vendu/perdu/Propria → is_published=true)
--   3. vue properties_publication_status filtrée (scope checklist publication)
--   4. backfill 28 biens vendus is_published=true (sécurisé via WHERE)
--   5. vendor_documents.doc_type enrichi avec 'bon_commande' (chantier B4)
--   6. achats_lots.purchase_order_doc_id FK vers vendor_documents
-- ============================================================================

-- ─── 1. Flag manuel d'exclusion publication ─────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS excluded_from_publication_checklist boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN properties.excluded_from_publication_checklist IS
  'Flag manuel "ne plus afficher dans /properties/incomplets". Pour les
  brouillons legacy qu''on ne complétera jamais. PAS équivalent à publié :
  ne fait pas apparaître le bien sur les listes publiques.';

-- ─── 2. Backfill biens vendus / perdus ──────────────────────────────────────
-- Sécurisé : ne fait rien si déjà publiés. Trace data_fix_log.
WITH targets AS (
  UPDATE properties
  SET is_published = true,
      published_at = COALESCE(published_at, now())
  WHERE deleted_at IS NULL
    AND is_published = false
    AND status::text IN ('vendu', 'perdu')
  RETURNING id, name, status::text AS prop_status
)
INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot, applied_at)
SELECT
  'auto_publish_sold_or_lost_2026_06_18',
  'property',
  id,
  jsonb_build_object('name', name, 'status', prop_status),
  now()
FROM targets
ON CONFLICT DO NOTHING;

-- ─── 3. Trigger anti-régression ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION properties_autopublish_on_aval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_published = false
     AND (
       (NEW.status::text IN ('vendu','perdu')
        AND (OLD.status::text IS DISTINCT FROM NEW.status::text))
       OR
       (NEW.propria_managed_at IS NOT NULL
        AND OLD.propria_managed_at IS NULL)
     )
  THEN
    NEW.is_published := true;
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_autopublish_trigger ON properties;
CREATE TRIGGER properties_autopublish_trigger
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION properties_autopublish_on_aval();

-- ─── 4. Vue properties_publication_status filtrée ───────────────────────────
CREATE OR REPLACE VIEW properties_publication_status AS
SELECT p.id, p.name, p.quartier, p.price, p.status, p.created_at,
    p.is_published, p.published_at, p.sourcing_type, p.assigned_chasseur,
    ch.full_name AS chasseur_name, p.partner_id, pa.agency_name AS partner_name,
    (p.sourcing_type = 'partenaire'::text AND p.partner_id IS NOT NULL)
      OR (p.sourcing_type = 'direct'::text AND p.assigned_chasseur IS NOT NULL)
      AS step2_sourcing_done,
    (EXISTS (SELECT 1 FROM property_media m WHERE m.property_id = p.id)) AS step3_media_done,
    array_remove(ARRAY[
        CASE WHEN p.sourcing_type IS NULL THEN 'sourcing_type'::text ELSE NULL END,
        CASE WHEN p.sourcing_type = 'partenaire' AND p.partner_id IS NULL THEN 'partner_id'::text ELSE NULL END,
        CASE WHEN p.sourcing_type = 'direct' AND p.assigned_chasseur IS NULL THEN 'assigned_chasseur'::text ELSE NULL END,
        CASE WHEN NOT (EXISTS (SELECT 1 FROM property_media m WHERE m.property_id = p.id)) THEN 'medias'::text ELSE NULL END
    ], NULL::text) AS missing_for_publication
FROM properties p
LEFT JOIN profiles ch ON ch.id = p.assigned_chasseur
LEFT JOIN partners pa ON pa.id = p.partner_id
WHERE p.deleted_at IS NULL
  AND p.status::text NOT IN ('vendu', 'perdu')
  AND p.propria_managed_at IS NULL
  AND p.excluded_from_publication_checklist = false;

-- ─── 5. vendor_documents.doc_type avec 'bon_commande' (chantier B4) ─────────
ALTER TABLE vendor_documents
  DROP CONSTRAINT IF EXISTS vendor_documents_doc_type_check;
ALTER TABLE vendor_documents
  ADD CONSTRAINT vendor_documents_doc_type_check
  CHECK (doc_type IN ('facture', 'devis', 'bon_commande'));

-- ─── 6. achats_lots.purchase_order_doc_id (chantier B4) ─────────────────────
ALTER TABLE achats_lots
  ADD COLUMN IF NOT EXISTS purchase_order_doc_id uuid
    REFERENCES vendor_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS achats_lots_purchase_order_doc_id_idx
  ON achats_lots(purchase_order_doc_id) WHERE purchase_order_doc_id IS NOT NULL;

COMMENT ON COLUMN achats_lots.purchase_order_doc_id IS
  'CEO 2026-06-18 — bon de commande fournisseur (vendor_documents.doc_type=bon_commande)';

NOTIFY pgrst, 'reload schema';
