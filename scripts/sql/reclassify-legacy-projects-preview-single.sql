-- ============================================================================
-- PREVIEW SINGLE — Une seule requête, tout visible d'un coup
-- ============================================================================
-- Liste TOUS les projets qui vont être touchés par la migration, avec une
-- colonne "action" qui dit ce qu'on va leur faire.
-- ============================================================================

SELECT
  CASE
    WHEN lower(c.email) IN (
      'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
      'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
      'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
      'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
      'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
      'benchaiba.younes@gmail.com', 'b.yousri@gmail.com'
    ) THEN '🔴 SUPPRIMER (perdu)'
    WHEN lower(c.email) IN (
      'dwissou@icloud.com', 'patsourd@aol.com', 'edlahcen@hotmail.fr',
      'shazad_1@msn.com', 'haroun_78@hotmail.fr', 'foudadredha@gmail.com',
      'steven.lebourhis@gmail.com', 'ducduy.n@gmail.com', 'hammoucheyamina@gmail.com',
      'supdev.zakaria@gmail.com'
    ) THEN '✅ PASSER TERMINE'
    WHEN lower(c.email) = 'seelalaoui@yahoo.fr'         THEN '🔵 ACTIF → travaux'
    WHEN lower(c.email) = 'boucheniata.hakim@gmail.com' THEN '🔵 ACTIF → onboarding'
    WHEN lower(c.email) = 'jn.saunier@gmail.com'        THEN '🔵 ACTIF → design'
  END AS action,
  c.full_name,
  c.email,
  COALESCE(p.code, p.reference) AS code,
  p.status AS status_actuel,
  p.current_phase AS phase_actuelle,
  p.created_at::date AS cree_le
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN (
  -- 17 emails perdus
  'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
  'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
  'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
  'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
  'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
  'benchaiba.younes@gmail.com', 'b.yousri@gmail.com',
  -- 10 emails livrés
  'dwissou@icloud.com', 'patsourd@aol.com', 'edlahcen@hotmail.fr',
  'shazad_1@msn.com', 'haroun_78@hotmail.fr', 'foudadredha@gmail.com',
  'steven.lebourhis@gmail.com', 'ducduy.n@gmail.com', 'hammoucheyamina@gmail.com',
  'supdev.zakaria@gmail.com',
  -- 3 emails actifs
  'seelalaoui@yahoo.fr', 'boucheniata.hakim@gmail.com', 'jn.saunier@gmail.com'
)
AND p.is_preparation = true
AND p.deleted_at IS NULL
ORDER BY action, c.full_name;
