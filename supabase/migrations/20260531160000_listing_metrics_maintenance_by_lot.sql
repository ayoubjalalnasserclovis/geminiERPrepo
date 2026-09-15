-- ============================================================================
-- Notes annonces & Maintenance préventive — passage au niveau LOT (listing)
-- ----------------------------------------------------------------------------
-- POURQUOI (métier) :
--   Chaque lot = un listing distinct. Les notes Airbnb/Booking et la maintenance
--   préventive doivent donc se suivre PAR LOT, pas par bien. Les colonnes
--   propria_unit_id existent déjà (migration 20260530000000) ; il manque :
--     1. les contraintes d'unicité au niveau lot (pour l'upsert / l'idempotence) ;
--     2. la fonction d'auto-génération de maintenance qui génère désormais
--        une visite par LOT actif (et non par bien).
--
-- Idempotent : CREATE UNIQUE INDEX IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- ============================================================================

-- ─── 1. Notes annonces : unicité (lot, plateforme, date) ────────────────────
-- Permet l'upsert createListingMetricAction au niveau lot.
CREATE UNIQUE INDEX IF NOT EXISTS propria_listing_metrics_unit_uniq
  ON propria_listing_metrics (propria_unit_id, platform, measured_at)
  WHERE propria_unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS propria_listing_metrics_unit_idx
  ON propria_listing_metrics (propria_unit_id, platform, measured_at DESC)
  WHERE propria_unit_id IS NOT NULL;

-- ─── 2. Maintenance : unicité (lot, trimestre) ──────────────────────────────
-- Idempotence de la génération trimestrielle au niveau lot.
CREATE UNIQUE INDEX IF NOT EXISTS propria_maintenance_unit_quarter_uniq
  ON propria_maintenance_visits (propria_unit_id, quarter)
  WHERE propria_unit_id IS NOT NULL;

-- ─── 3. Auto-génération de la maintenance préventive PAR LOT ─────────────────
-- Une visite par trimestre PAR LOT ACTIF des biens sous gestion Propria.
-- Scoping Option B : propria_unit_id rempli, property_id NULL.
CREATE OR REPLACE FUNCTION propria_generate_maintenance_visits(target_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  q TEXT := quarter_label(target_date);
  due DATE := quarter_end_date(target_date);
  inserted_count INTEGER;
BEGIN
  WITH ins AS (
    INSERT INTO propria_maintenance_visits (propria_unit_id, quarter, due_date, status)
    SELECT
      u.id,
      q,
      due,
      CASE WHEN due < CURRENT_DATE THEN 'en_retard' ELSE 'a_planifier' END
    FROM propria_units u
    JOIN properties p ON p.id = u.property_id
    WHERE p.propria_managed_at IS NOT NULL
      AND p.deleted_at IS NULL
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM propria_maintenance_visits mv
        WHERE mv.propria_unit_id = u.id AND mv.quarter = q
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM ins;
  RETURN inserted_count;
END $$;

GRANT EXECUTE ON FUNCTION propria_generate_maintenance_visits(DATE) TO authenticated;
