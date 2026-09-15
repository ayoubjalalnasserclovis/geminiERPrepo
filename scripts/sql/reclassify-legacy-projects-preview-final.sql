-- ============================================================================
-- PREVIEW FINAL — Garde vs Supprime, validation visuelle
-- ============================================================================
-- Affiche pour chaque projet matchant : KEEP ou DELETE + justification
-- Doit donner ~24 KEEP + ~35 DELETE
--   KEEP = 10 livrés dédupliqués + 3 actifs reclassifiés + 1 BEJ GUENI = 14
--   Mais en réalité on a 24 KEEP car on a 10+3+1 livrés survivants + Hakim 4 vrais projets
--   Re-calcul : LIVRÉS 10 survivants + Jean-Noël 1 + Faiçal 1 + Hakim 4 → mais on supprime 2 BEJ GUENI
--   Donc KEEP = 10 (livrés) + 1 (Jean-Noël) + 1 (Faiçal) + 2 (Hakim RIAD + 1 BEJ GUENI) = 14
--   DELETE = 7 doublons livrés + 1 doublon Jean-Noël + 1 doublon Faiçal + 2 doublons Hakim + 34 perdus = 45
--   Total matching = 14 + 45 = 59 ✓
-- ============================================================================

WITH livres_ranked AS (
  SELECT p.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.email
      ORDER BY
        CASE p.current_phase WHEN 'termine' THEN 1 ELSE 2 END,
        p.created_at
    ) AS rn
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
)
SELECT
  CASE
    -- DELETE cases
    WHEN p.id IN (SELECT id FROM livres_ranked WHERE rn > 1)
      THEN '🗑 DELETE — doublon livré'
    WHEN lower(c.email) = 'jn.saunier@gmail.com' AND p.current_phase != 'design'
      THEN '🗑 DELETE — doublon Jean-Noël'
    WHEN lower(c.email) = 'seelalaoui@yahoo.fr' AND p.current_phase != 'travaux'
      THEN '🗑 DELETE — doublon Faiçal'
    WHEN lower(c.email) = 'boucheniata.hakim@gmail.com'
      AND p.code IN ('boucheniata-hakim-bej-gueni-2', 'boucheniata-hakim-bej-gueni-3')
      THEN '🗑 DELETE — doublon BEJ GUENI'
    WHEN lower(c.email) IN (
      'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
      'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
      'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
      'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
      'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
      'benchaiba.younes@gmail.com', 'b.yousri@gmail.com'
    ) THEN '🗑 DELETE — perdu'
    -- KEEP cases
    WHEN lower(c.email) IN (
      'dwissou@icloud.com', 'patsourd@aol.com', 'edlahcen@hotmail.fr',
      'shazad_1@msn.com', 'haroun_78@hotmail.fr', 'foudadredha@gmail.com',
      'steven.lebourhis@gmail.com', 'ducduy.n@gmail.com', 'hammoucheyamina@gmail.com',
      'supdev.zakaria@gmail.com'
    ) THEN '✅ KEEP — passe en termine'
    WHEN lower(c.email) = 'jn.saunier@gmail.com'
      THEN '✅ KEEP — Jean-Noël reste en design'
    WHEN lower(c.email) = 'seelalaoui@yahoo.fr'
      THEN '✅ KEEP — Faiçal reste en travaux'
    WHEN lower(c.email) = 'boucheniata.hakim@gmail.com' AND p.code = 'hakim-boucheniata-riad-1'
      THEN '✅ KEEP — Hakim RIAD 1 reste en sourcing'
    WHEN lower(c.email) = 'boucheniata.hakim@gmail.com' AND p.code = 'boucheniata-hakim-bej-gueni'
      THEN '✅ KEEP — BEJ GUENI passe en termine'
  END AS action,
  c.full_name,
  p.code,
  p.current_phase AS phase_actuelle,
  p.status AS status_actuel
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN (
  'chadenizot@gmail.com', 'david.edith@free.fr', 'hajar.benbouja@gmail.com',
  'cedric.lebar@gmail.com', 'harratkacem@gmail.com', 'khalid.bouarich@yahoo.fr',
  'falkamir@gmail.com', 'maxime.viotti@gmail.com', 'moufekkir.nabil@gmail.com',
  'contact@nathanpissaro.com', 'rachid.boukkari@live.fr', 'richard.kandabile@gmail.com',
  'samiainnes10@gmail.com', 'slimane.benbrahim@gmail.com', 'smoussabbih@gmail.com',
  'benchaiba.younes@gmail.com', 'b.yousri@gmail.com',
  'dwissou@icloud.com', 'patsourd@aol.com', 'edlahcen@hotmail.fr',
  'shazad_1@msn.com', 'haroun_78@hotmail.fr', 'foudadredha@gmail.com',
  'steven.lebourhis@gmail.com', 'ducduy.n@gmail.com', 'hammoucheyamina@gmail.com',
  'supdev.zakaria@gmail.com',
  'seelalaoui@yahoo.fr', 'boucheniata.hakim@gmail.com', 'jn.saunier@gmail.com'
)
AND p.is_preparation = true
AND p.deleted_at IS NULL
ORDER BY action DESC, c.full_name;
