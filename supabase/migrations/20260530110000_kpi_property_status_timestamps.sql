-- ════════════════════════════════════════════════════════════════════════════
-- #4 — Horodatage des changements de statut des biens
-- Permet de mesurer la VÉLOCITÉ du sourcing (biens atteignant "disponible" / semaine)
-- et de détecter les BIENS MORTS (statut "propose"/"disponible" qui stagne).
-- Avant : aucun timestamp de transition → on utilisait created_at comme proxy imprécis.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS disponible_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS propose_at    TIMESTAMPTZ;

-- Backfill approximatif des biens déjà dans ces statuts (proxy = created_at).
-- Les transitions futures seront horodatées précisément par le trigger ci-dessous.
UPDATE properties
  SET disponible_at = COALESCE(disponible_at, created_at)
  WHERE status = 'disponible' AND disponible_at IS NULL;

UPDATE properties
  SET propose_at = COALESCE(propose_at, created_at)
  WHERE status = 'propose' AND propose_at IS NULL;

-- Trigger : à chaque entrée dans un statut, on horodate.
-- (overwrite volontaire : "depuis quand dans le statut courant" = ce qu'il faut
--  pour mesurer la stagnation et la vélocité d'entrée.)
CREATE OR REPLACE FUNCTION stamp_property_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'disponible' THEN
      NEW.disponible_at := now();
    ELSIF NEW.status = 'propose' THEN
      NEW.propose_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS properties_stamp_status_change ON properties;
CREATE TRIGGER properties_stamp_status_change
  BEFORE UPDATE OF status ON properties
  FOR EACH ROW EXECUTE FUNCTION stamp_property_status_change();
