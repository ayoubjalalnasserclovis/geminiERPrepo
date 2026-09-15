-- ============================================================================
-- Vue v_property_completeness — Score de complétude par bien Propria actif
-- ============================================================================
-- Calcule pour chaque bien sous gestion Propria active le nombre de champs
-- opérationnels renseignés sur 17, avec la liste explicite des champs
-- manquants. Périmètre :
--   propria_managed_at IS NOT NULL
--   AND propria_refused_at IS NULL
--   AND deleted_at IS NULL
--
-- Source de vérité partagée avec le widget React PropertyDataCompleteness
-- (components/projects/property-data-completeness.tsx). Tout ajout / retrait
-- de champ doit se faire SIMULTANÉMENT ici et dans le composant React.
--
-- Définition "rempli" :
--   - string : non null ET trim(value) <> ''
--   - boolean (propria_smart_lock) : non null (false compte comme rempli)
--   - numeric (superficie) : non null
--
-- La vue est recalculée à la lecture (pas de table matérialisée). Volume
-- estimé : quelques dizaines de biens à court terme, quelques centaines à
-- long terme — acceptable.
-- ============================================================================

CREATE OR REPLACE VIEW v_property_completeness AS
WITH counts AS (
  SELECT
    p.id AS property_id,
    p.name,
    p.propria_internal_code,

    -- 17 champs évalués individuellement pour le compteur
    (CASE WHEN p.address IS NOT NULL AND length(trim(p.address)) > 0 THEN 1 ELSE 0 END) AS f_address,
    (CASE WHEN p.quartier IS NOT NULL AND length(trim(p.quartier)) > 0 THEN 1 ELSE 0 END) AS f_quartier,
    (CASE WHEN p.floor IS NOT NULL AND length(trim(p.floor)) > 0 THEN 1 ELSE 0 END) AS f_floor,
    (CASE WHEN p.superficie IS NOT NULL THEN 1 ELSE 0 END) AS f_superficie,
    (CASE WHEN p.propria_apartment_door IS NOT NULL AND length(trim(p.propria_apartment_door)) > 0 THEN 1 ELSE 0 END) AS f_apartment_door,
    (CASE WHEN p.propria_google_maps_url IS NOT NULL AND length(trim(p.propria_google_maps_url)) > 0 THEN 1 ELSE 0 END) AS f_google_maps,
    (CASE WHEN p.propria_water_contract IS NOT NULL AND length(trim(p.propria_water_contract)) > 0 THEN 1 ELSE 0 END) AS f_water_contract,
    (CASE WHEN p.propria_water_meter IS NOT NULL AND length(trim(p.propria_water_meter)) > 0 THEN 1 ELSE 0 END) AS f_water_meter,
    (CASE WHEN p.propria_electricity_contract IS NOT NULL AND length(trim(p.propria_electricity_contract)) > 0 THEN 1 ELSE 0 END) AS f_elec_contract,
    (CASE WHEN p.propria_electricity_meter IS NOT NULL AND length(trim(p.propria_electricity_meter)) > 0 THEN 1 ELSE 0 END) AS f_elec_meter,
    (CASE WHEN p.propria_internet_provider IS NOT NULL AND length(trim(p.propria_internet_provider)) > 0 THEN 1 ELSE 0 END) AS f_internet_provider,
    (CASE WHEN p.propria_internet_contract IS NOT NULL AND length(trim(p.propria_internet_contract)) > 0 THEN 1 ELSE 0 END) AS f_internet_contract,
    (CASE WHEN p.propria_wifi_ssid IS NOT NULL AND length(trim(p.propria_wifi_ssid)) > 0 THEN 1 ELSE 0 END) AS f_wifi_ssid,
    (CASE WHEN p.propria_wifi_password IS NOT NULL AND length(trim(p.propria_wifi_password)) > 0 THEN 1 ELSE 0 END) AS f_wifi_password,
    (CASE WHEN p.propria_lock_code IS NOT NULL AND length(trim(p.propria_lock_code)) > 0 THEN 1 ELSE 0 END) AS f_lock_code,
    (CASE WHEN p.propria_smart_lock IS NOT NULL THEN 1 ELSE 0 END) AS f_smart_lock,
    (CASE WHEN p.propria_access_admin IS NOT NULL AND length(trim(p.propria_access_admin)) > 0 THEN 1 ELSE 0 END) AS f_access_admin,

    -- Libellés des champs manquants (même ordre que le widget React)
    ARRAY_REMOVE(ARRAY[
      CASE WHEN p.address IS NULL OR length(trim(p.address)) = 0 THEN 'Adresse complète' END,
      CASE WHEN p.quartier IS NULL OR length(trim(p.quartier)) = 0 THEN 'Quartier' END,
      CASE WHEN p.floor IS NULL OR length(trim(p.floor)) = 0 THEN 'Étage' END,
      CASE WHEN p.superficie IS NULL THEN 'Superficie' END,
      CASE WHEN p.propria_apartment_door IS NULL OR length(trim(p.propria_apartment_door)) = 0 THEN 'N° de porte' END,
      CASE WHEN p.propria_google_maps_url IS NULL OR length(trim(p.propria_google_maps_url)) = 0 THEN 'Lien Google Maps' END,
      CASE WHEN p.propria_water_contract IS NULL OR length(trim(p.propria_water_contract)) = 0 THEN 'N° contrat eau' END,
      CASE WHEN p.propria_water_meter IS NULL OR length(trim(p.propria_water_meter)) = 0 THEN 'N° compteur eau' END,
      CASE WHEN p.propria_electricity_contract IS NULL OR length(trim(p.propria_electricity_contract)) = 0 THEN 'N° contrat électricité' END,
      CASE WHEN p.propria_electricity_meter IS NULL OR length(trim(p.propria_electricity_meter)) = 0 THEN 'N° compteur électricité' END,
      CASE WHEN p.propria_internet_provider IS NULL OR length(trim(p.propria_internet_provider)) = 0 THEN 'Fournisseur internet' END,
      CASE WHEN p.propria_internet_contract IS NULL OR length(trim(p.propria_internet_contract)) = 0 THEN 'N° contrat internet' END,
      CASE WHEN p.propria_wifi_ssid IS NULL OR length(trim(p.propria_wifi_ssid)) = 0 THEN 'SSID Wifi' END,
      CASE WHEN p.propria_wifi_password IS NULL OR length(trim(p.propria_wifi_password)) = 0 THEN 'Mot de passe Wifi' END,
      CASE WHEN p.propria_lock_code IS NULL OR length(trim(p.propria_lock_code)) = 0 THEN 'Code serrure' END,
      CASE WHEN p.propria_smart_lock IS NULL THEN 'Serrure électronique' END,
      CASE WHEN p.propria_access_admin IS NULL OR length(trim(p.propria_access_admin)) = 0 THEN 'Codes accès immeuble' END
    ], NULL) AS missing_fields

  FROM properties p
  WHERE p.propria_managed_at IS NOT NULL
    AND p.propria_refused_at IS NULL
    AND p.deleted_at IS NULL
)
SELECT
  c.property_id,
  c.name,
  c.propria_internal_code,
  (
    c.f_address + c.f_quartier + c.f_floor + c.f_superficie +
    c.f_apartment_door + c.f_google_maps +
    c.f_water_contract + c.f_water_meter +
    c.f_elec_contract + c.f_elec_meter +
    c.f_internet_provider + c.f_internet_contract +
    c.f_wifi_ssid + c.f_wifi_password +
    c.f_lock_code + c.f_smart_lock + c.f_access_admin
  ) AS filled_count,
  17 AS total_count,
  ROUND((
    c.f_address + c.f_quartier + c.f_floor + c.f_superficie +
    c.f_apartment_door + c.f_google_maps +
    c.f_water_contract + c.f_water_meter +
    c.f_elec_contract + c.f_elec_meter +
    c.f_internet_provider + c.f_internet_contract +
    c.f_wifi_ssid + c.f_wifi_password +
    c.f_lock_code + c.f_smart_lock + c.f_access_admin
  )::numeric * 100 / 17)::int AS completion_pct,
  (
    c.f_address + c.f_quartier + c.f_floor + c.f_superficie +
    c.f_apartment_door + c.f_google_maps +
    c.f_water_contract + c.f_water_meter +
    c.f_elec_contract + c.f_elec_meter +
    c.f_internet_provider + c.f_internet_contract +
    c.f_wifi_ssid + c.f_wifi_password +
    c.f_lock_code + c.f_smart_lock + c.f_access_admin
  ) = 17 AS is_complete,
  c.missing_fields
FROM counts c;

COMMENT ON VIEW v_property_completeness IS
  'Score de complétude des infos par bien Propria actif. 17 champs évalués, miroir du widget React PropertyDataCompleteness. Recalculé à la lecture.';

GRANT SELECT ON v_property_completeness TO authenticated;
