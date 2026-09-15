-- ============================================================================
-- DIAGNOSTIC — Y a-t-il d'autres biens en base pour ces 4 clients ?
-- ============================================================================
-- Pour Hakim, Paul Benneli, Paul Ferrera : liste TOUS leurs projets + biens
-- (incluant ceux qu'on n'a pas touchés cette nuit) pour voir s'il existe
-- déjà des biens "fantômes" dans la base qu'on aurait pu réutiliser
-- au lieu de créer des doublons.
-- ============================================================================

SELECT
  c.full_name AS proprietaire,
  pr.id AS project_id,
  pr.code AS projet_code,
  pr.current_phase,
  pr.legacy_imported,
  p.id AS property_id,
  p.name AS bien,
  p.address,
  p.price AS prix,
  pr.compromis_date,
  pr.livraison_date,
  p.propria_managed_at IS NOT NULL AS en_propria,
  p.propria_internal_code AS code_propria
FROM clients c
LEFT JOIN projects pr ON pr.client_id = c.id AND pr.deleted_at IS NULL
LEFT JOIN properties p ON p.id = pr.property_id AND p.deleted_at IS NULL
WHERE c.email IN (
  'boucheniata.hakim@gmail.com',   -- Hakim (cherche AF, MAJO)
  'paulbenelli1@gmail.com',         -- Paul Benneli (cherche PAUL)
  'souad.meziane@hotmail.com'       -- Paul Ferrera (cherche PATISSERIE KAWTAR)
)
ORDER BY c.full_name, pr.created_at NULLS LAST;

-- ─── Aussi vérifier les biens ORPHELINS (sans projet lié) qui pourraient
-- correspondre par adresse ou nom ──────────────────────────────────────────
SELECT
  '🔍 Biens orphelins potentiels' AS section,
  p.id,
  p.name,
  p.address,
  p.price,
  p.created_at::date,
  p.propria_managed_at IS NOT NULL AS en_propria
FROM properties p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.property_id = p.id AND pr.deleted_at IS NULL)
  AND (
    p.name ILIKE '%allal%fassi%' OR
    p.address ILIKE '%allal%fassi%' OR
    p.name ILIKE '%majorella%' OR
    p.address ILIKE '%majorella%' OR
    p.name ILIKE '%asbahani%' OR
    p.address ILIKE '%asbahani%' OR
    p.name ILIKE '%moulay%abdellah%' OR
    p.address ILIKE '%moulay%abdellah%' OR
    p.name ILIKE '%kawtar%' OR
    p.name ILIKE '%bej%gueni%' OR
    p.address ILIKE '%al%hanae%'
  )
ORDER BY p.created_at DESC;
