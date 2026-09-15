-- ============================================================================
-- DIAGNOSTIC — Vérifier la chaîne client → projet → bien → lots pour Hakim
-- ============================================================================
-- But : prouver que la STRUCTURE DB lie tout correctement, et identifier
-- si c'est l'affichage UI qui manque.
-- ============================================================================

SELECT
  c.id AS client_id,
  c.full_name AS client_name,
  c.email AS client_email,
  p.id AS project_id,
  COALESCE(p.code, p.reference) AS project_code,
  p.legacy_imported,
  p.current_phase,
  pr.id AS property_id,
  pr.name AS property_name,
  pr.propria_internal_code,
  pr.propria_managed_at IS NOT NULL AS en_propria,
  u.id AS unit_id,
  u.code AS unit_code,
  u.propria_wifi_ssid,
  u.propria_base_price_per_night,
  u.propria_airbnb_url IS NOT NULL AS airbnb_present
FROM clients c
LEFT JOIN projects p ON p.client_id = c.id AND p.deleted_at IS NULL
LEFT JOIN properties pr ON pr.id = p.property_id AND pr.deleted_at IS NULL
LEFT JOIN propria_units u ON u.property_id = pr.id AND u.deleted_at IS NULL
WHERE c.email = 'boucheniata.hakim@gmail.com'
ORDER BY p.created_at, pr.propria_internal_code NULLS LAST, u.order_index;
