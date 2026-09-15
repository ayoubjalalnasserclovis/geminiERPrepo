-- ============================================================================
-- DIAGNOSTIC — Doublons biens Notion vs biens PROPRIA cette nuit
-- ============================================================================
-- Pour chaque propriétaire PROPRIA, liste TOUS les biens qui lui sont
-- rattachés via un projet. On distingue :
--   - Origin Notion : propria_managed_at IS NULL, peut avoir price + dates
--   - Origin PROPRIA cette nuit : propria_managed_at IS NOT NULL
-- ============================================================================

SELECT
  c.full_name AS proprietaire,
  c.email,
  p.id AS property_id,
  p.name AS bien,
  p.address,
  p.price AS prix,
  pr.code AS projet_code,
  pr.current_phase AS phase,
  pr.legacy_imported,
  pr.compromis_date,
  pr.acte_authentique_date,
  pr.livraison_date,
  p.propria_managed_at IS NOT NULL AS en_propria,
  p.propria_internal_code AS code_propria,
  CASE
    WHEN p.propria_managed_at IS NOT NULL AND p.price IS NOT NULL THEN '✅ Bien PROPRIA avec prix'
    WHEN p.propria_managed_at IS NOT NULL AND p.price IS NULL THEN '🟡 Bien PROPRIA sans prix (créé cette nuit)'
    WHEN p.propria_managed_at IS NULL AND p.price IS NOT NULL THEN '🟢 Bien Notion (a le prix)'
    ELSE '⚪ Autre'
  END AS verdict
FROM clients c
JOIN projects pr ON pr.client_id = c.id AND pr.deleted_at IS NULL
JOIN properties p ON p.id = pr.property_id AND p.deleted_at IS NULL
WHERE c.email IN (
  'boucheniata.hakim@gmail.com', 'foudadredha@gmail.com', 'elbadaoui.yassine@hotmail.com',
  'steven.lebourhis@gmail.com', 'patsourd@aol.com', 'cafc.eleulj.elmamoun@gmail.com',
  'ducduy.n@gmail.com', 'paulbenelli1@gmail.com', 'catherinevrard@hotmail.com',
  'kamil.joundy@gmail.com', 'souad.meziane@hotmail.com', 'hammoucheyamina@gmail.com'
)
ORDER BY c.full_name, p.propria_internal_code NULLS LAST, p.created_at;
