-- ============================================================================
-- Refonte fiche bien Propria :
--   - Quartier liste fermée (gardé en TEXT pour souplesse mais validé côté front)
--   - Suppression latitude/longitude/adresse perso/artisan référent
--   - Nouveaux booleans : fiche d'infos, caméra installée, accès admin app
--   - Nouveaux booleans : syndic à payer + montant syndic
--   - Accès admin serrure : boolean
--   - Type accès immeuble : enum
-- ============================================================================

-- 1. Nouveaux champs
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS propria_smart_lock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS propria_building_access_type TEXT,
  ADD COLUMN IF NOT EXISTS propria_nb_elevator_badges INTEGER,
  ADD COLUMN IF NOT EXISTS propria_info_sheet_to_send BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS propria_camera_installed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS propria_app_admin_access BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS propria_syndic_to_pay BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS propria_syndic_amount NUMERIC(12, 2);

-- 2. Contrainte sur le type d'accès immeuble
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS propria_building_access_type_check;
ALTER TABLE properties
  ADD CONSTRAINT propria_building_access_type_check CHECK (
    propria_building_access_type IS NULL OR propria_building_access_type IN (
      'ouvert_24_24',
      'cle',
      'badge_ascenseur',
      'badge_immeuble',
      'badge_asc_cle',
      'digicode'
    )
  );

-- 3. Index utile pour le filtrage des biens qui n'ont pas encore reçu leur fiche
CREATE INDEX IF NOT EXISTS properties_info_sheet_to_send_idx
  ON properties (propria_info_sheet_to_send)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN properties.propria_smart_lock IS 'Le bien a-t-il une serrure connectée admin (oui/non)';
COMMENT ON COLUMN properties.propria_building_access_type IS 'Type d''accès immeuble : ouvert_24_24, cle, badge_ascenseur, badge_immeuble, badge_asc_cle, digicode';
COMMENT ON COLUMN properties.propria_info_sheet_to_send IS 'Indique si la fiche d''informations doit être envoyée';
COMMENT ON COLUMN properties.propria_camera_installed IS 'Caméras déjà installées sur le bien';
COMMENT ON COLUMN properties.propria_app_admin_access IS 'Le propriétaire a-t-il un accès admin via app (Airbnb, Booking)';
COMMENT ON COLUMN properties.propria_syndic_to_pay IS 'Charges de syndic à régler pour ce bien';
COMMENT ON COLUMN properties.propria_syndic_amount IS 'Montant mensuel des charges syndic (MAD)';
