-- ============================================================================
-- FIX — Renommer codes projets PROPRIA legacy pour qu'ils incluent le bien
-- ============================================================================
-- Problème : les projets créés pour AF, MAJO, WARDA, BADAOUI AF, etc. ont
-- des codes auto-générés sur le slug client + suffixe (ex bej-gueni-2)
-- au lieu d'inclure le code du bien.
--
-- Cible : code = <client_slug>-<propria_internal_code slugifié>
-- Ex : boucheniata-hakim-bej-gueni-2 (AF) → boucheniata-hakim-af
--
-- Sécurité : on UPDATE uniquement projects.legacy_imported = true avec une
-- property liée propria_managed_at IS NOT NULL.
-- ============================================================================

-- ─── DIAGNOSTIC d'abord (lecture seule) ─────────────────────────────────────

SELECT
  p.id AS project_id,
  p.code AS code_actuel,
  c.slug AS client_slug,
  pr.propria_internal_code AS bien_code,
  -- Code attendu = client_slug + '-' + slugified(propria_internal_code)
  c.slug || '-' || trim(both '-' from lower(regexp_replace(pr.propria_internal_code, '[^a-zA-Z0-9]+', '-', 'g'))) AS code_attendu,
  CASE
    WHEN p.code = c.slug || '-' || trim(both '-' from lower(regexp_replace(pr.propria_internal_code, '[^a-zA-Z0-9]+', '-', 'g')))
      THEN '✅ OK'
    ELSE '🔴 À renommer'
  END AS verdict
FROM projects p
JOIN clients c ON c.id = p.client_id
JOIN properties pr ON pr.id = p.property_id
WHERE p.legacy_imported = true
  AND p.deleted_at IS NULL
  AND pr.propria_managed_at IS NOT NULL
  AND pr.propria_internal_code IS NOT NULL
ORDER BY c.full_name, p.code;

-- ⛔ STOP — Vérifie le diagnostic. Si OK, exécute le bloc UPDATE ci-dessous.

-- ─── UPDATE (transaction unique) ─────────────────────────────────────────────
/*
BEGIN;

UPDATE projects p
SET code = c.slug || '-' || trim(both '-' from lower(regexp_replace(pr.propria_internal_code, '[^a-zA-Z0-9]+', '-', 'g'))),
    updated_at = now()
FROM clients c, properties pr
WHERE p.client_id = c.id
  AND p.property_id = pr.id
  AND p.legacy_imported = true
  AND p.deleted_at IS NULL
  AND pr.propria_managed_at IS NOT NULL
  AND pr.propria_internal_code IS NOT NULL
  AND p.code <> c.slug || '-' || trim(both '-' from lower(regexp_replace(pr.propria_internal_code, '[^a-zA-Z0-9]+', '-', 'g')));

-- Vérification post-fix
SELECT
  '📊 Post-fix' AS info,
  COUNT(*) AS nb_projets_legacy_total,
  COUNT(*) FILTER (
    WHERE p.code = c.slug || '-' || trim(both '-' from lower(regexp_replace(pr.propria_internal_code, '[^a-zA-Z0-9]+', '-', 'g')))
  ) AS nb_codes_corrects
FROM projects p
JOIN clients c ON c.id = p.client_id
JOIN properties pr ON pr.id = p.property_id
WHERE p.legacy_imported = true AND p.deleted_at IS NULL
  AND pr.propria_managed_at IS NOT NULL AND pr.propria_internal_code IS NOT NULL;

COMMIT;
*/
