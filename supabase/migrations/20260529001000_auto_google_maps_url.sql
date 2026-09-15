-- ============================================================================
-- Auto-génération propria_google_maps_url depuis address
-- ============================================================================
-- Une seule règle : si l'adresse est renseignée ET que google_maps_url est vide,
-- générer automatiquement le lien Google Maps. L'utilisateur garde la main pour
-- override (ex: lien plus précis vers une entrée d'immeuble).
--
-- Trigger BEFORE INSERT/UPDATE sur properties : maintient la cohérence à chaque
-- modification, sans dépendre de l'endpoint qui édite (activation Propria,
-- /properties/[id]/edit, futures actions…).
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_generate_google_maps_url()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Auto-génère si maps_url est vide ET adresse renseignée
  IF (NEW.propria_google_maps_url IS NULL OR NEW.propria_google_maps_url = '')
     AND NEW.address IS NOT NULL
     AND TRIM(NEW.address) != '' THEN
    NEW.propria_google_maps_url := 'https://www.google.com/maps/search/?api=1&query='
      || REPLACE(REPLACE(TRIM(NEW.address), ' ', '+'), ',', '%2C');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_google_maps_on_properties ON properties;
CREATE TRIGGER auto_google_maps_on_properties
  BEFORE INSERT OR UPDATE OF address, propria_google_maps_url ON properties
  FOR EACH ROW EXECUTE FUNCTION auto_generate_google_maps_url();

COMMENT ON FUNCTION auto_generate_google_maps_url IS
  'Auto-populate propria_google_maps_url depuis address quand il est vide. L''utilisateur peut override en saisissant un lien custom.';

-- Backfill : applique sur les biens existants qui ont une adresse mais pas de URL
UPDATE properties
SET address = address  -- déclenche le trigger
WHERE address IS NOT NULL
  AND TRIM(address) != ''
  AND (propria_google_maps_url IS NULL OR propria_google_maps_url = '');
