-- ============================================================================
-- AUDIT — Tous les projets et clients de test résiduels en prod (lecture seule)
-- ============================================================================
-- Heuristiques de détection :
--   1. Code projet contenant 'test'
--   2. Email client = perso staff (Othmane, Yassine ELFAIQ, etc.)
--   3. Email avec domaine dev typique (arko-media, etc.)
--   4. full_name client contenant 'TEST' ou 'test'
-- ============================================================================

SELECT
  p.id AS project_id,
  COALESCE(p.code, p.reference) AS project_code,
  p.current_phase, p.status, p.legacy_imported, p.is_preparation,
  p.created_at::date AS cree_le,
  c.id AS client_id,
  c.full_name,
  c.email,
  c.phone,
  EXISTS (SELECT 1 FROM properties pr WHERE pr.id = p.property_id) AS a_property,
  CASE
    WHEN lower(COALESCE(p.code, '')) LIKE '%test%'                THEN '🔴 Code contient "test"'
    WHEN lower(c.full_name) LIKE '%test%'                          THEN '🔴 Nom contient "test"'
    WHEN c.email IN ('othmane@stoniz.co', 'elazouzi.othmane@gmail.com')
                                                                  THEN '🟡 Email = Othmane (perso)'
    WHEN lower(c.email) LIKE '%@arko-media.com%'                  THEN '🟡 Email = arko-media (dev externe)'
    WHEN lower(c.email) LIKE '%yassine.elfaiq%'                   THEN '🟡 Email = Yassine ELFAIQ'
    WHEN lower(c.email) LIKE '%@stoniz.co%' AND c.email <> 'othmane@stoniz.co'
                                                                  THEN '🟡 Email staff @stoniz.co'
    ELSE '⚪'
  END AS verdict
FROM projects p
LEFT JOIN clients c ON c.id = p.client_id
WHERE p.deleted_at IS NULL
  AND (
    lower(COALESCE(p.code, '')) LIKE '%test%'
    OR lower(COALESCE(c.full_name, '')) LIKE '%test%'
    OR c.email IN ('othmane@stoniz.co', 'elazouzi.othmane@gmail.com')
    OR lower(c.email) LIKE '%@arko-media.com%'
    OR lower(c.email) LIKE '%yassine.elfaiq%'
    OR (lower(c.email) LIKE '%@stoniz.co%' AND c.email <> 'othmane@stoniz.co')
  )
ORDER BY p.created_at DESC;

-- ─── Vue agrégée : combien de chaque catégorie ──────────────────────────────
SELECT
  '📊 Résumé suspicion' AS section,
  COUNT(*) FILTER (WHERE lower(COALESCE(p.code, '')) LIKE '%test%')                AS code_avec_test,
  COUNT(*) FILTER (WHERE lower(COALESCE(c.full_name, '')) LIKE '%test%')           AS nom_avec_test,
  COUNT(*) FILTER (WHERE c.email IN ('othmane@stoniz.co', 'elazouzi.othmane@gmail.com')) AS email_othmane,
  COUNT(*) FILTER (WHERE lower(c.email) LIKE '%@arko-media.com%')                  AS email_arko,
  COUNT(*) FILTER (WHERE lower(c.email) LIKE '%yassine.elfaiq%')                   AS email_yassine
FROM projects p
LEFT JOIN clients c ON c.id = p.client_id
WHERE p.deleted_at IS NULL;
