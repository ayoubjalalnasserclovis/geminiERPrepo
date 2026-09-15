-- ============================================================================
-- DIAGNOSTIC — 5 sujets fiche projet PROPRIA legacy (lecture seule)
-- ============================================================================

-- ─── 1. WiFi + lock_code : identique ou divergent entre lots d'un même bien ?
SELECT
  '1. WiFi/Lock par bien' AS section,
  p.id AS property_id,
  p.name AS bien,
  p.propria_internal_code AS code,
  COUNT(DISTINCT u.propria_wifi_ssid) AS wifi_ssid_distinct,
  COUNT(DISTINCT u.propria_wifi_password) AS wifi_pass_distinct,
  COUNT(DISTINCT u.propria_lock_code) AS lock_code_distinct,
  COUNT(u.id) AS nb_lots,
  MAX(u.propria_wifi_ssid) AS exemple_wifi_ssid,
  MAX(u.propria_lock_code) AS exemple_lock_code
FROM properties p
JOIN propria_units u ON u.property_id = p.id AND u.deleted_at IS NULL
WHERE p.propria_managed_at IS NOT NULL
  AND p.deleted_at IS NULL
GROUP BY p.id, p.name, p.propria_internal_code
ORDER BY p.propria_internal_code;

-- Verdict : si toutes les colonnes _distinct = 1 → migration vers BIEN OK

-- ─── 3. Dates clés sur projets PROPRIA legacy ──────────────────────────────
SELECT
  '3. Dates projets legacy' AS section,
  pj.id AS project_id,
  pj.code,
  pj.current_phase,
  pj.onboarding_date,
  pj.compromis_date,
  pj.acte_authentique_date,
  pj.travaux_start_date,
  pj.travaux_end_date,
  pj.livraison_date
FROM projects pj
WHERE pj.legacy_imported = true
  AND pj.deleted_at IS NULL
ORDER BY pj.code;

-- Verdict : si toutes NULL → on ajoute UI d'édition CEO (pas de backfill auto)

-- ─── 4. Prix + honoraires sur biens PROPRIA legacy ─────────────────────────
SELECT
  '4. Prix biens legacy' AS section,
  pj.code AS project_code,
  p.name AS bien,
  p.price AS prix_bien,
  pj.stoniz_fees_acquisition,
  pj.stoniz_fees_travaux,
  pj.travaux_budget
FROM projects pj
JOIN properties p ON p.id = pj.property_id
WHERE pj.legacy_imported = true
  AND pj.deleted_at IS NULL
  AND p.deleted_at IS NULL
ORDER BY pj.code;

-- Verdict : si tout NULL → ajouter UI d'édition manuelle CEO (les biens sont
-- déjà achetés, le prix historique n'est pas dans le CSV PROPRIA)

-- ─── 2. Paiements sur projets legacy ───────────────────────────────────────
SELECT
  '2. Paiements projets legacy' AS section,
  pj.code,
  pj.current_phase,
  COUNT(pay.id) AS nb_payments,
  COUNT(pay.id) FILTER (WHERE pay.status = 'paid') AS nb_payes,
  STRING_AGG(DISTINCT pay.type, ', ') AS types
FROM projects pj
LEFT JOIN payments pay ON pay.project_id = pj.id AND pay.deleted_at IS NULL
WHERE pj.legacy_imported = true
  AND pj.deleted_at IS NULL
GROUP BY pj.code, pj.current_phase
ORDER BY pj.code;

-- Verdict attendu : 0 payments partout (DELETE pendant import) → option (b)
-- ou (c) : créer les records, ou masquer la section
