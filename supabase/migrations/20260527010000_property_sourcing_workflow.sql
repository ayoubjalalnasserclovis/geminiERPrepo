-- ============================================================================
-- Workflow sourcing biens en plusieurs étapes :
--   1. Import (champs essentiels)
--   2. Sourcing (partenaire OU direct + chasseur assigné)
--   3. Médias (photos / vidéo)
--   4. Publication → bien visible côté équipe projet et plus tard côté client
--
-- + Suppression emprunt/impôts
-- + Auto-calc frais notaire 7% / frais agence 3% / revenu locatif brut
-- ============================================================================

-- 1. Nouveaux champs sourcing & publication
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS sourcing_type TEXT
    CHECK (sourcing_type IS NULL OR sourcing_type IN ('partenaire', 'direct')),
  ADD COLUMN IF NOT EXISTS sourcing_direct_channel TEXT,
  ADD COLUMN IF NOT EXISTS assigned_chasseur UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES profiles(id);

-- 2. Tous les biens existants sont considérés publiés (rétrocompat)
UPDATE properties SET is_published = true WHERE is_published = false AND created_at < now();

-- 3. Index utile pour le filtre rapide
CREATE INDEX IF NOT EXISTS properties_is_published_idx
  ON properties (is_published) WHERE deleted_at IS NULL;

-- 4. Vue d'agrégation : biens incomplets (pas encore publiés)
CREATE OR REPLACE VIEW properties_publication_status AS
SELECT
  p.id,
  p.name,
  p.quartier,
  p.price,
  p.status,
  p.created_at,
  p.is_published,
  p.published_at,
  p.sourcing_type,
  p.assigned_chasseur,
  ch.full_name AS chasseur_name,
  p.partner_id,
  pa.agency_name AS partner_name,
  -- Étape 2 OK si sourcing renseigné
  (p.sourcing_type = 'partenaire' AND p.partner_id IS NOT NULL)
    OR (p.sourcing_type = 'direct' AND p.assigned_chasseur IS NOT NULL) AS step2_sourcing_done,
  -- Étape 3 OK s'il y a au moins 1 média
  EXISTS (
    SELECT 1 FROM property_media m
    WHERE m.property_id = p.id
  ) AS step3_media_done,
  -- Liste des étapes manquantes pour publication
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.sourcing_type IS NULL THEN 'sourcing_type' END,
    CASE WHEN p.sourcing_type = 'partenaire' AND p.partner_id IS NULL THEN 'partner_id' END,
    CASE WHEN p.sourcing_type = 'direct' AND p.assigned_chasseur IS NULL THEN 'assigned_chasseur' END,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM property_media m WHERE m.property_id = p.id
    ) THEN 'medias' END
  ], NULL) AS missing_for_publication
FROM properties p
LEFT JOIN profiles ch ON ch.id = p.assigned_chasseur
LEFT JOIN partners pa ON pa.id = p.partner_id
WHERE p.deleted_at IS NULL;

GRANT SELECT ON properties_publication_status TO authenticated;

-- 5. Fonction de publication d'un bien (force la vérification des étapes)
CREATE OR REPLACE FUNCTION publish_property(p_property_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT missing_for_publication INTO v_missing
  FROM properties_publication_status
  WHERE id = p_property_id;

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Impossible de publier : étapes manquantes (%)', array_to_string(v_missing, ', ');
  END IF;

  UPDATE properties
    SET is_published = true,
        published_at = now(),
        published_by = auth.uid(),
        updated_at = now()
    WHERE id = p_property_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6. Fonction de dépublication (remettre en draft pour modifs majeures)
CREATE OR REPLACE FUNCTION unpublish_property(p_property_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE properties
    SET is_published = false,
        published_at = NULL,
        published_by = NULL,
        updated_at = now()
    WHERE id = p_property_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
