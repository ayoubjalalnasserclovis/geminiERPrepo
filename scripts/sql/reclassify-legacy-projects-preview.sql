-- ============================================================================
-- PREVIEW v3 — Reclassification des 30 projets legacy
-- ============================================================================
-- Lookup par email (stable) + filtre is_preparation = true pour cibler
-- UNIQUEMENT les imports Notion. Évite de toucher des projets vivants attachés
-- au même client suite au merge d'hier.
--
-- ⚠ EXÉCUTER CE FICHIER EN PREMIER, VÉRIFIER LES RÉSULTATS,
--   PUIS EXÉCUTER reclassify-legacy-projects-migrate.sql
-- ============================================================================

-- ─── 1. Projets PERDUS à supprimer (17 emails, is_preparation = true) ───────
SELECT
  '🔴 À SUPPRIMER (PERDU)' AS action,
  p.id AS project_id,
  COALESCE(p.code, p.reference) AS code,
  c.full_name,
  c.email,
  p.status,
  p.current_phase,
  p.is_preparation,
  p.created_at::date
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN (
  'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
  'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
  'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
  'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
  'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
  'benchaiba.younes@gmail.com', 'b.yousri@gmail.com'
)
AND p.is_preparation = true
AND p.deleted_at IS NULL
ORDER BY c.full_name;

-- ─── 2. Volume des données liées aux projets à supprimer ────────────────────
WITH perdus_projects AS (
  SELECT p.id AS project_id
  FROM projects p
  JOIN clients c ON c.id = p.client_id
  WHERE lower(c.email) IN (
    'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
    'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
    'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
    'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
    'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
    'benchaiba.younes@gmail.com', 'b.yousri@gmail.com'
  )
  AND p.is_preparation = true
  AND p.deleted_at IS NULL
)
SELECT
  '📊 Volume données liées' AS info,
  (SELECT COUNT(*) FROM perdus_projects) AS nb_projets,
  (SELECT COUNT(*) FROM documents WHERE project_id IN (SELECT project_id FROM perdus_projects)) AS nb_documents,
  (SELECT COUNT(*) FROM payments WHERE project_id IN (SELECT project_id FROM perdus_projects)) AS nb_payments,
  (SELECT COUNT(*) FROM tasks WHERE project_id IN (SELECT project_id FROM perdus_projects)) AS nb_tasks;

-- ─── 3. Clients ayant aussi des projets VIVANTS (alerte avant DELETE client) ─
-- Si une ligne sort ici, on NE doit PAS supprimer le client, juste ses projets legacy.
SELECT
  '⚠ Client a aussi des projets vivants (on garde le client)' AS warning,
  c.id AS client_id,
  c.full_name,
  c.email,
  COUNT(p2.id) AS nb_projets_vivants,
  STRING_AGG(COALESCE(p2.code, p2.reference) || ' (' || p2.status || ')', ', ') AS detail
FROM clients c
JOIN projects p2 ON p2.client_id = c.id
WHERE lower(c.email) IN (
  'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
  'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
  'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
  'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
  'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
  'benchaiba.younes@gmail.com', 'b.yousri@gmail.com'
)
AND p2.deleted_at IS NULL
AND p2.is_preparation = false  -- projet vivant
GROUP BY c.id, c.full_name, c.email
ORDER BY c.full_name;

-- ─── 4. Projets LIVRÉS à passer en termine (10 emails, is_preparation=true) ──
SELECT
  '✅ À PASSER TERMINE' AS action,
  p.id AS project_id,
  COALESCE(p.code, p.reference) AS code,
  c.full_name,
  c.email,
  p.status,
  p.current_phase,
  p.is_preparation
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN (
  'dwissou@icloud.com', 'patsourd@aol.com', 'edlahcen@hotmail.fr',
  'shazad_1@msn.com', 'haroun_78@hotmail.fr', 'foudadredha@gmail.com',
  'steven.lebourhis@gmail.com', 'ducduy.n@gmail.com', 'hammoucheyamina@gmail.com',
  'supdev.zakaria@gmail.com'
)
AND p.is_preparation = true
AND p.deleted_at IS NULL
ORDER BY c.full_name;

-- ─── 5. Projets ACTIFS à reclassifier (3 emails, is_preparation=true) ───────
SELECT
  '🔵 À RECLASSIFIER (ACTIF)' AS action,
  p.id AS project_id,
  COALESCE(p.code, p.reference) AS code,
  c.full_name,
  c.email,
  p.status AS status_actuel,
  p.current_phase AS phase_actuelle,
  CASE lower(c.email)
    WHEN 'seelalaoui@yahoo.fr'         THEN 'travaux'
    WHEN 'boucheniata.hakim@gmail.com' THEN 'onboarding'
    WHEN 'jn.saunier@gmail.com'        THEN 'design'
  END AS phase_cible
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN (
  'seelalaoui@yahoo.fr', 'boucheniata.hakim@gmail.com', 'jn.saunier@gmail.com'
)
AND p.is_preparation = true
AND p.deleted_at IS NULL
ORDER BY c.full_name;

-- ─── 6. Sanity check : doit donner exactement 17 / 10 / 3 ───────────────────
SELECT
  '🔎 Sanity check totaux (is_preparation=true)' AS info,
  (SELECT COUNT(*) FROM projects p JOIN clients c ON c.id=p.client_id
     WHERE lower(c.email) IN (
       'chadenizot@gmail.com','david.edith@free.fr','hajar.benbouja@gmail.com',
       'cedric.lebar@gmail.com','harratkacem@gmail.com','khalid.bouarich@yahoo.fr',
       'falkamir@gmail.com','maxime.viotti@gmail.com','moufekkir.nabil@gmail.com',
       'contact@nathanpissaro.com','rachid.boukkari@live.fr','richard.kandabile@gmail.com',
       'samiainnes10@gmail.com','slimane.benbrahim@gmail.com','smoussabbih@gmail.com',
       'benchaiba.younes@gmail.com','b.yousri@gmail.com'
     ) AND p.is_preparation = true AND p.deleted_at IS NULL) AS nb_perdus_matches,
  (SELECT COUNT(*) FROM projects p JOIN clients c ON c.id=p.client_id
     WHERE lower(c.email) IN (
       'dwissou@icloud.com','patsourd@aol.com','edlahcen@hotmail.fr',
       'shazad_1@msn.com','haroun_78@hotmail.fr','foudadredha@gmail.com',
       'steven.lebourhis@gmail.com','ducduy.n@gmail.com','hammoucheyamina@gmail.com',
       'supdev.zakaria@gmail.com'
     ) AND p.is_preparation = true AND p.deleted_at IS NULL) AS nb_termine_matches,
  (SELECT COUNT(*) FROM projects p JOIN clients c ON c.id=p.client_id
     WHERE lower(c.email) IN (
       'seelalaoui@yahoo.fr','boucheniata.hakim@gmail.com','jn.saunier@gmail.com'
     ) AND p.is_preparation = true AND p.deleted_at IS NULL) AS nb_actif_matches;
