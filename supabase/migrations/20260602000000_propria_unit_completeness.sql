-- ============================================================================
-- Vue v_propria_unit_completeness — Score de complétude par LOT Propria actif
-- ============================================================================
-- Décision CEO 2026-06-02 : passage du compteur "biens à compléter" à "lots à
-- compléter" sur le dashboard Propria. La vraie unité de gestion = la suite
-- (propria_units), pas le bien parent (properties).
--
-- Périmètre :
--   - propria_units actifs (deleted_at IS NULL)
--   - dont le bien parent est sous gestion Propria :
--       properties.propria_managed_at IS NOT NULL
--       AND properties.propria_refused_at IS NULL
--       AND properties.deleted_at IS NULL
--
-- 21 critères évalués par lot :
--   - 12 champs hérités du BIEN parent (partagés entre toutes les suites
--     du même bien) : adresse, quartier, étage, superficie, Google Maps,
--     contrats eau/élec/internet, compteurs, codes accès immeuble
--   - 9 critères SPÉCIFIQUES au lot (sur propria_units) :
--       1. N° de porte (propria_apartment_door)
--       2. Capacité voyageurs (propria_capacity_voyageurs)
--       3. Nombre de chambres (propria_nb_chambres)
--       4. Type de lits (propria_type_lits)
--       5. Accès : propria_lock_code OU propria_smart_lock = true (OR)
--       6. Wifi : propria_wifi_ssid ET propria_wifi_password (AND)
--       7. Annonce : propria_airbnb_url OU propria_booking_url (OR)
--       8. Prix nuitée (propria_base_price_per_night)
--       9. Nombre de clés (propria_nb_keys)
--
-- Recalculée à la lecture (pas de table matérialisée). Volume estimé :
-- quelques centaines de lots max — acceptable.
-- ============================================================================

CREATE OR REPLACE VIEW v_propria_unit_completeness AS
WITH counts AS (
  SELECT
    u.id AS unit_id,
    u.code AS unit_code,
    u.order_index,
    u.property_id,
    p.name AS property_name,

    -- ─── 12 champs du BIEN parent ─────────────────────────────────────────
    (CASE WHEN p.address IS NOT NULL AND length(trim(p.address)) > 0 THEN 1 ELSE 0 END) AS f_address,
    (CASE WHEN p.quartier IS NOT NULL AND length(trim(p.quartier)) > 0 THEN 1 ELSE 0 END) AS f_quartier,
    (CASE WHEN p.floor IS NOT NULL AND length(trim(p.floor)) > 0 THEN 1 ELSE 0 END) AS f_floor,
    (CASE WHEN p.superficie IS NOT NULL THEN 1 ELSE 0 END) AS f_superficie,
    (CASE WHEN p.propria_google_maps_url IS NOT NULL AND length(trim(p.propria_google_maps_url)) > 0 THEN 1 ELSE 0 END) AS f_google_maps,
    (CASE WHEN p.propria_water_contract IS NOT NULL AND length(trim(p.propria_water_contract)) > 0 THEN 1 ELSE 0 END) AS f_water_contract,
    (CASE WHEN p.propria_water_meter IS NOT NULL AND length(trim(p.propria_water_meter)) > 0 THEN 1 ELSE 0 END) AS f_water_meter,
    (CASE WHEN p.propria_electricity_contract IS NOT NULL AND length(trim(p.propria_electricity_contract)) > 0 THEN 1 ELSE 0 END) AS f_elec_contract,
    (CASE WHEN p.propria_electricity_meter IS NOT NULL AND length(trim(p.propria_electricity_meter)) > 0 THEN 1 ELSE 0 END) AS f_elec_meter,
    (CASE WHEN p.propria_internet_provider IS NOT NULL AND length(trim(p.propria_internet_provider)) > 0 THEN 1 ELSE 0 END) AS f_internet_provider,
    (CASE WHEN p.propria_internet_contract IS NOT NULL AND length(trim(p.propria_internet_contract)) > 0 THEN 1 ELSE 0 END) AS f_internet_contract,
    (CASE WHEN p.propria_access_admin IS NOT NULL AND length(trim(p.propria_access_admin)) > 0 THEN 1 ELSE 0 END) AS f_access_admin,

    -- ─── 9 critères du LOT ────────────────────────────────────────────────
    (CASE WHEN u.propria_apartment_door IS NOT NULL AND length(trim(u.propria_apartment_door)) > 0 THEN 1 ELSE 0 END) AS f_apartment_door,
    (CASE WHEN u.propria_capacity_voyageurs IS NOT NULL THEN 1 ELSE 0 END) AS f_capacity,
    (CASE WHEN u.propria_nb_chambres IS NOT NULL THEN 1 ELSE 0 END) AS f_nb_chambres,
    (CASE WHEN u.propria_type_lits IS NOT NULL AND length(trim(u.propria_type_lits)) > 0 THEN 1 ELSE 0 END) AS f_type_lits,
    -- Accès : OR sur lock_code ou smart_lock (au moins un des deux)
    (CASE WHEN (u.propria_lock_code IS NOT NULL AND length(trim(u.propria_lock_code)) > 0)
            OR (u.propria_smart_lock = true)
       THEN 1 ELSE 0 END) AS f_acces,
    -- Wifi : SSID ET password (les deux ensemble)
    (CASE WHEN u.propria_wifi_ssid IS NOT NULL AND length(trim(u.propria_wifi_ssid)) > 0
           AND u.propria_wifi_password IS NOT NULL AND length(trim(u.propria_wifi_password)) > 0
       THEN 1 ELSE 0 END) AS f_wifi,
    -- Annonce : OR sur Airbnb ou Booking
    (CASE WHEN (u.propria_airbnb_url IS NOT NULL AND length(trim(u.propria_airbnb_url)) > 0)
            OR (u.propria_booking_url IS NOT NULL AND length(trim(u.propria_booking_url)) > 0)
       THEN 1 ELSE 0 END) AS f_annonce,
    (CASE WHEN u.propria_base_price_per_night IS NOT NULL THEN 1 ELSE 0 END) AS f_price,
    (CASE WHEN u.propria_nb_keys IS NOT NULL THEN 1 ELSE 0 END) AS f_nb_keys,

    -- ─── Libellés des critères manquants (pour UI à venir) ───────────────
    ARRAY_REMOVE(ARRAY[
      -- Champs bien
      CASE WHEN p.address IS NULL OR length(trim(p.address)) = 0 THEN 'Adresse complète (bien)' END,
      CASE WHEN p.quartier IS NULL OR length(trim(p.quartier)) = 0 THEN 'Quartier (bien)' END,
      CASE WHEN p.floor IS NULL OR length(trim(p.floor)) = 0 THEN 'Étage (bien)' END,
      CASE WHEN p.superficie IS NULL THEN 'Superficie (bien)' END,
      CASE WHEN p.propria_google_maps_url IS NULL OR length(trim(p.propria_google_maps_url)) = 0 THEN 'Lien Google Maps (bien)' END,
      CASE WHEN p.propria_water_contract IS NULL OR length(trim(p.propria_water_contract)) = 0 THEN 'N° contrat eau (bien)' END,
      CASE WHEN p.propria_water_meter IS NULL OR length(trim(p.propria_water_meter)) = 0 THEN 'N° compteur eau (bien)' END,
      CASE WHEN p.propria_electricity_contract IS NULL OR length(trim(p.propria_electricity_contract)) = 0 THEN 'N° contrat électricité (bien)' END,
      CASE WHEN p.propria_electricity_meter IS NULL OR length(trim(p.propria_electricity_meter)) = 0 THEN 'N° compteur électricité (bien)' END,
      CASE WHEN p.propria_internet_provider IS NULL OR length(trim(p.propria_internet_provider)) = 0 THEN 'Fournisseur internet (bien)' END,
      CASE WHEN p.propria_internet_contract IS NULL OR length(trim(p.propria_internet_contract)) = 0 THEN 'N° contrat internet (bien)' END,
      CASE WHEN p.propria_access_admin IS NULL OR length(trim(p.propria_access_admin)) = 0 THEN 'Codes accès immeuble (bien)' END,
      -- Critères lot
      CASE WHEN u.propria_apartment_door IS NULL OR length(trim(u.propria_apartment_door)) = 0 THEN 'N° de porte (lot)' END,
      CASE WHEN u.propria_capacity_voyageurs IS NULL THEN 'Capacité voyageurs (lot)' END,
      CASE WHEN u.propria_nb_chambres IS NULL THEN 'Nombre de chambres (lot)' END,
      CASE WHEN u.propria_type_lits IS NULL OR length(trim(u.propria_type_lits)) = 0 THEN 'Type de lits (lot)' END,
      CASE WHEN NOT ((u.propria_lock_code IS NOT NULL AND length(trim(u.propria_lock_code)) > 0)
                  OR (u.propria_smart_lock = true)) THEN 'Accès — code ou serrure connectée (lot)' END,
      CASE WHEN NOT (u.propria_wifi_ssid IS NOT NULL AND length(trim(u.propria_wifi_ssid)) > 0
                 AND u.propria_wifi_password IS NOT NULL AND length(trim(u.propria_wifi_password)) > 0)
             THEN 'Wifi — SSID + mot de passe (lot)' END,
      CASE WHEN NOT ((u.propria_airbnb_url IS NOT NULL AND length(trim(u.propria_airbnb_url)) > 0)
                  OR (u.propria_booking_url IS NOT NULL AND length(trim(u.propria_booking_url)) > 0))
             THEN 'Annonce Airbnb ou Booking (lot)' END,
      CASE WHEN u.propria_base_price_per_night IS NULL THEN 'Prix nuitée de base (lot)' END,
      CASE WHEN u.propria_nb_keys IS NULL THEN 'Nombre de clés (lot)' END
    ], NULL) AS missing_fields

  FROM propria_units u
  JOIN properties p ON p.id = u.property_id
  WHERE u.deleted_at IS NULL
    AND p.propria_managed_at IS NOT NULL
    AND p.propria_refused_at IS NULL
    AND p.deleted_at IS NULL
)
SELECT
  c.unit_id,
  c.unit_code,
  c.order_index,
  c.property_id,
  c.property_name,
  (
    c.f_address + c.f_quartier + c.f_floor + c.f_superficie +
    c.f_google_maps +
    c.f_water_contract + c.f_water_meter +
    c.f_elec_contract + c.f_elec_meter +
    c.f_internet_provider + c.f_internet_contract +
    c.f_access_admin +
    c.f_apartment_door + c.f_capacity + c.f_nb_chambres + c.f_type_lits +
    c.f_acces + c.f_wifi + c.f_annonce + c.f_price + c.f_nb_keys
  ) AS filled_count,
  21 AS total_count,
  ROUND((
    c.f_address + c.f_quartier + c.f_floor + c.f_superficie +
    c.f_google_maps +
    c.f_water_contract + c.f_water_meter +
    c.f_elec_contract + c.f_elec_meter +
    c.f_internet_provider + c.f_internet_contract +
    c.f_access_admin +
    c.f_apartment_door + c.f_capacity + c.f_nb_chambres + c.f_type_lits +
    c.f_acces + c.f_wifi + c.f_annonce + c.f_price + c.f_nb_keys
  )::numeric * 100 / 21)::int AS completion_pct,
  (
    c.f_address + c.f_quartier + c.f_floor + c.f_superficie +
    c.f_google_maps +
    c.f_water_contract + c.f_water_meter +
    c.f_elec_contract + c.f_elec_meter +
    c.f_internet_provider + c.f_internet_contract +
    c.f_access_admin +
    c.f_apartment_door + c.f_capacity + c.f_nb_chambres + c.f_type_lits +
    c.f_acces + c.f_wifi + c.f_annonce + c.f_price + c.f_nb_keys
  ) = 21 AS is_complete,
  c.missing_fields
FROM counts c;

COMMENT ON VIEW v_propria_unit_completeness IS
  'Score de complétude par LOT Propria actif. 21 critères (12 bien + 9 lot). Décision CEO 2026-06-02 : la vraie unité de gestion = la suite, pas le bien.';

GRANT SELECT ON v_propria_unit_completeness TO authenticated;
