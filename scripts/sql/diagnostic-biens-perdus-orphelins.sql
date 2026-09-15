-- ============================================================================
-- DIAGNOSTIC — Biens orphelins / perdus importés de Notion (lecture seule)
-- ============================================================================
-- Identifie les biens candidats à suppression :
--   - Orphelins : pas de projet vivant qui pointe dessus
--   - Probablement issus de Notion (notion_page_id non NULL)
--   - Non-PROPRIA (propria_managed_at NULL)
-- ============================================================================

-- ─── 1. Récap quantitatif ──────────────────────────────────────────────────
SELECT
  '📊 Récap' AS section,
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NULL) AS total_biens_actifs,
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NULL AND propria_managed_at IS NOT NULL) AS biens_propria,
  (SELECT COUNT(*) FROM properties p WHERE p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.property_id = p.id AND pr.deleted_at IS NULL)
  ) AS biens_orphelins;

-- ─── 2. Liste détaillée des biens orphelins ────────────────────────────────
SELECT
  '🗑 Bien orphelin (candidat suppression)' AS section,
  p.id,
  p.name,
  p.address,
  p.price,
  p.propria_owner_name AS owner,
  p.notion_page_id IS NOT NULL AS vient_de_notion,
  p.propria_managed_at IS NOT NULL AS en_propria,
  p.created_at::date,
  -- Trouve le client probable via les projets supprimés (legacy_imported = true)
  -- qui auraient pu pointer ce bien (mais on n'a pas data_fix_log donc on cherche
  -- par adresse ou nom similaire)
  (SELECT c.full_name FROM clients c
   JOIN projects pj ON pj.client_id = c.id
   WHERE pj.property_id = p.id
   LIMIT 1) AS client_via_projet_existant
FROM properties p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM projects pr
    WHERE pr.property_id = p.id AND pr.deleted_at IS NULL
  )
ORDER BY p.created_at;

-- ─── 3. Détail des propria_units éventuelles sur ces biens orphelins ───────
SELECT
  '📌 Lots Propria sur biens orphelins (à supprimer aussi)' AS section,
  p.name AS bien,
  COUNT(u.id) AS nb_lots
FROM properties p
LEFT JOIN propria_units u ON u.property_id = p.id AND u.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.property_id = p.id AND pr.deleted_at IS NULL)
GROUP BY p.id, p.name
HAVING COUNT(u.id) > 0
ORDER BY p.name;
