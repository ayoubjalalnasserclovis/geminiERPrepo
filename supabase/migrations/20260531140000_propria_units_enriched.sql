-- ============================================================================
-- Vue socle propria_units_enriched — le LOT (listing) enrichi des infos du BIEN
-- ----------------------------------------------------------------------------
-- POURQUOI (métier) :
--   L'équipe projet saisit les infos PARTAGÉES du bâtiment sur le BIEN
--   (adresse, étage, GMaps, n° clients eau/élec/internet, serrure principale,
--   wifi…) — pas de double saisie. Une fois le bien géré côté Propria, tout le
--   travail opérationnel se fait au niveau LISTING (lot).
--
--   Cette vue fait l'HÉRITAGE À LA LECTURE : chaque lot expose ses champs
--   propres (prix, Airbnb, capacité, porte de la suite) ET, sans recopie, les
--   champs partagés du bien. Source unique :
--     - champs bâtiment  → toujours depuis properties
--     - champs listing   → COALESCE(lot, bien) : le lot prime, le bien sert de
--       valeur héritée par défaut (utile pendant la transition où certaines
--       valeurs vivent encore sur le bien)
--
--   AUCUNE donnée n'est dupliquée ni stockée : recalcul à la lecture.
--   security_invoker = on → la RLS de l'appelant s'applique (cohérent Propria).
--
-- Idempotent : CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE VIEW propria_units_enriched AS
SELECT
  -- ─── Identité du lot ───────────────────────────────────────────────
  u.id                              AS unit_id,
  u.property_id,
  u.code                            AS lot_code,
  u.order_index,
  u.is_active,
  u.deleted_at,

  -- ─── Contexte bâtiment (hérité, source = properties) ───────────────
  p.name                            AS bien_name,
  p.propria_internal_code           AS bien_code,
  p.quartier,
  p.address,
  p.floor,
  p.superficie,
  p.propria_google_maps_url         AS google_maps_url,
  p.propria_owner_name,
  p.propria_managed_at,
  p.propria_refused_at,
  -- Utilities (toujours bâtiment)
  p.propria_water_contract,
  p.propria_water_meter,
  p.propria_electricity_contract,
  p.propria_electricity_meter,
  p.propria_internet_provider,
  p.propria_internet_contract,
  -- Accès bâtiment partagé (wifi 1 box, serrure principale)
  p.propria_wifi_ssid,
  p.propria_wifi_password,
  p.propria_lock_code,
  p.propria_smart_lock,
  p.propria_access_admin,
  p.propria_key_box_building,
  p.propria_arrival_video_url,
  p.propria_commission_rate,

  -- ─── Champs listing (source = lot, hérités du bien par défaut) ─────
  COALESCE(u.propria_apartment_door,        p.propria_apartment_door)        AS apartment_door,
  COALESCE(u.propria_capacity_voyageurs,    p.propria_capacity_voyageurs)    AS capacity_voyageurs,
  COALESCE(u.propria_nb_chambres,           p.propria_nb_chambres)           AS nb_chambres,
  COALESCE(u.propria_type_lits,             p.propria_type_lits)             AS type_lits,
  COALESCE(u.propria_airbnb_url,            p.propria_airbnb_url)            AS airbnb_url,
  COALESCE(u.propria_booking_url,           p.propria_booking_url)           AS booking_url,
  COALESCE(u.propria_listing_published_at,  p.propria_listing_published_at)  AS listing_published_at,
  COALESCE(u.propria_base_price_per_night,  p.propria_base_price_per_night)  AS base_price_per_night,
  COALESCE(u.propria_drive_photos_url,      p.propria_drive_photos_url)      AS drive_photos_url,
  COALESCE(u.propria_default_provider_id,   p.propria_default_provider_id)   AS default_provider_id,
  COALESCE(u.propria_info_sheet_to_send,    p.propria_info_sheet_to_send)    AS info_sheet_to_send,
  COALESCE(u.propria_app_admin_access,      p.propria_app_admin_access)      AS app_admin_access,
  COALESCE(u.propria_observations,          p.propria_observations)          AS observations,
  -- Propre au lot (pas d'équivalent bien)
  u.propria_key_box_suite           AS key_box_suite,

  -- ─── Libellé prêt à l'emploi pour les sélecteurs ───────────────────
  (u.code || ' · ' || COALESCE(p.propria_internal_code, p.name)
    || COALESCE(' (' || p.quartier || ')', '')) AS display_label

FROM propria_units u
JOIN properties p ON p.id = u.property_id
WHERE u.deleted_at IS NULL
  AND p.deleted_at IS NULL;

ALTER VIEW propria_units_enriched SET (security_invoker = on);

COMMENT ON VIEW propria_units_enriched IS
  'Lot (listing) enrichi : champs propres du lot + héritage à la lecture des infos partagées du bien (adresse, utilities, serrure/wifi principaux, GMaps). Source unique, aucune recopie. Socle des sélecteurs et écrans Propria orientés lot.';

GRANT SELECT ON propria_units_enriched TO authenticated;
