-- ============================================================================
-- DIAGNOSTIC — Complétude des biens PROPRIA après import (lecture seule)
-- ============================================================================
-- Pour chaque propriétaire : nb biens, nb lots, état des contrats (eau, élec,
-- internet), wifi présent sur les units.
-- ============================================================================

SELECT
  c.full_name AS proprietaire,
  COUNT(DISTINCT pr.id) AS nb_biens,
  COUNT(DISTINCT u.id) AS nb_lots,
  -- État contrats au niveau bien (au moins 1 bien avec contrat rempli)
  SUM(CASE WHEN pr.propria_water_contract IS NOT NULL AND pr.propria_water_contract <> '' THEN 1 ELSE 0 END) AS biens_avec_eau,
  SUM(CASE WHEN pr.propria_electricity_contract IS NOT NULL AND pr.propria_electricity_contract <> '' THEN 1 ELSE 0 END) AS biens_avec_elec,
  SUM(CASE WHEN pr.propria_internet_contract IS NOT NULL AND pr.propria_internet_contract <> '' THEN 1 ELSE 0 END) AS biens_avec_internet,
  -- État wifi au niveau lot
  SUM(CASE WHEN u.propria_wifi_ssid IS NOT NULL AND u.propria_wifi_ssid <> '' THEN 1 ELSE 0 END) AS lots_avec_wifi,
  SUM(CASE WHEN u.propria_lock_code IS NOT NULL AND u.propria_lock_code <> '' THEN 1 ELSE 0 END) AS lots_avec_code_serrure,
  SUM(CASE WHEN u.propria_airbnb_url IS NOT NULL AND u.propria_airbnb_url <> '' THEN 1 ELSE 0 END) AS lots_avec_airbnb
FROM clients c
JOIN projects p ON p.client_id = c.id AND p.deleted_at IS NULL
JOIN properties pr ON pr.id = p.property_id AND pr.deleted_at IS NULL AND pr.propria_managed_at IS NOT NULL
LEFT JOIN propria_units u ON u.property_id = pr.id AND u.deleted_at IS NULL
WHERE c.email IN (
  'boucheniata.hakim@gmail.com', 'foudadredha@gmail.com', 'elbadaoui.yassine@hotmail.com',
  'steven.lebourhis@gmail.com', 'patsourd@aol.com', 'cafc.eleulj.elmamoun@gmail.com',
  'ducduy.n@gmail.com', 'paulbenelli1@gmail.com', 'catherinevrard@hotmail.com',
  'kamil.joundy@gmail.com', 'souad.meziane@hotmail.com', 'hammoucheyamina@gmail.com'
)
GROUP BY c.full_name
ORDER BY c.full_name;

-- ─── Sanity check total ────────────────────────────────────────────────────
SELECT
  '📊 Totaux' AS info,
  (SELECT COUNT(*) FROM properties WHERE propria_managed_at IS NOT NULL AND deleted_at IS NULL) AS total_biens_propria,
  (SELECT COUNT(*) FROM propria_units u JOIN properties p ON p.id = u.property_id
   WHERE u.deleted_at IS NULL AND p.deleted_at IS NULL AND p.propria_managed_at IS NOT NULL) AS total_lots;
