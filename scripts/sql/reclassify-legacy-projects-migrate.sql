-- ============================================================================
-- MIGRATION FINALE v2 — Reclassification + Déduplication (DO block compat pooler)
-- ============================================================================
-- DO block PL/pgSQL : tout s'exécute dans une seule session atomique,
-- compatible avec le pooler de Supabase SQL editor.
-- ============================================================================

DO $$
DECLARE
  to_delete UUID[];
  perdus_clients UUID[];
BEGIN
  -- ─── 1. Construire la liste des IDs à supprimer ──────────────────────────
  SELECT ARRAY_AGG(id) INTO to_delete
  FROM (
    -- 1a. Doublons livrés (garde celui en termine, sinon le plus ancien)
    SELECT p.id
    FROM (
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
    ) p
    WHERE p.rn > 1

    UNION ALL

    -- 1b. Doublon Jean-Noël (garde le design)
    SELECT p.id
    FROM projects p
    JOIN clients c ON c.id = p.client_id
    WHERE lower(c.email) = 'jn.saunier@gmail.com'
      AND p.current_phase != 'design'
      AND p.is_preparation = true
      AND p.deleted_at IS NULL

    UNION ALL

    -- 1c. Doublon Faiçal (garde le travaux)
    SELECT p.id
    FROM projects p
    JOIN clients c ON c.id = p.client_id
    WHERE lower(c.email) = 'seelalaoui@yahoo.fr'
      AND p.current_phase != 'travaux'
      AND p.is_preparation = true
      AND p.deleted_at IS NULL

    UNION ALL

    -- 1d. Doublons Hakim BEJ GUENI -2 et -3
    SELECT p.id
    FROM projects p
    JOIN clients c ON c.id = p.client_id
    WHERE lower(c.email) = 'boucheniata.hakim@gmail.com'
      AND p.code IN ('boucheniata-hakim-bej-gueni-2', 'boucheniata-hakim-bej-gueni-3')
      AND p.is_preparation = true
      AND p.deleted_at IS NULL

    UNION ALL

    -- 1e. Tous les perdus
    SELECT p.id
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
  ) sub;

  RAISE NOTICE 'Nombre de projets à supprimer : %', COALESCE(array_length(to_delete, 1), 0);

  -- ─── 2. Capturer les client_ids des perdus (avant DELETE projects) ──────
  SELECT ARRAY_AGG(DISTINCT p.client_id) INTO perdus_clients
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
  AND p.deleted_at IS NULL;

  -- ─── 3. DELETE des dépendances ──────────────────────────────────────────
  IF to_delete IS NOT NULL AND array_length(to_delete, 1) > 0 THEN
    DELETE FROM documents          WHERE project_id = ANY(to_delete);
    DELETE FROM payments           WHERE project_id = ANY(to_delete);
    DELETE FROM tasks              WHERE project_id = ANY(to_delete);
    DELETE FROM project_phases_history WHERE project_id = ANY(to_delete);
    DELETE FROM project_notes      WHERE project_id = ANY(to_delete);
    DELETE FROM project_briefs     WHERE project_id = ANY(to_delete);
    DELETE FROM property_proposals WHERE project_id = ANY(to_delete);

    -- ─── 4. DELETE des projets ────────────────────────────────────────────
    DELETE FROM projects WHERE id = ANY(to_delete);
    RAISE NOTICE 'Projets supprimés.';
  END IF;

  -- ─── 5. DELETE des clients orphelins (perdus uniquement) ────────────────
  IF perdus_clients IS NOT NULL AND array_length(perdus_clients, 1) > 0 THEN
    DELETE FROM clients
    WHERE id = ANY(perdus_clients)
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = clients.id);
    RAISE NOTICE 'Clients orphelins supprimés.';
  END IF;

  -- ─── 6. UPDATE livrés restants → termine ────────────────────────────────
  UPDATE projects p
  SET status = 'termine',
      current_phase = 'termine',
      updated_at = now()
  FROM clients c
  WHERE c.id = p.client_id
    AND lower(c.email) IN (
      'dwissou@icloud.com', 'patsourd@aol.com', 'edlahcen@hotmail.fr',
      'shazad_1@msn.com', 'haroun_78@hotmail.fr', 'foudadredha@gmail.com',
      'steven.lebourhis@gmail.com', 'ducduy.n@gmail.com', 'hammoucheyamina@gmail.com',
      'supdev.zakaria@gmail.com'
    )
    AND p.is_preparation = true
    AND p.deleted_at IS NULL;

  -- ─── 7. UPDATE Hakim BEJ GUENI restant → termine ────────────────────────
  UPDATE projects p
  SET status = 'termine',
      current_phase = 'termine',
      updated_at = now()
  FROM clients c
  WHERE c.id = p.client_id
    AND lower(c.email) = 'boucheniata.hakim@gmail.com'
    AND p.code = 'boucheniata-hakim-bej-gueni'
    AND p.is_preparation = true
    AND p.deleted_at IS NULL;

  -- ─── 8. UPDATE actifs (Jean-Noël, Faiçal, Hakim RIAD 1) → status='actif' ─
  UPDATE projects p
  SET status = 'actif', updated_at = now()
  FROM clients c
  WHERE c.id = p.client_id
    AND (
      (lower(c.email) = 'jn.saunier@gmail.com'         AND p.current_phase = 'design')   OR
      (lower(c.email) = 'seelalaoui@yahoo.fr'          AND p.current_phase = 'travaux')  OR
      (lower(c.email) = 'boucheniata.hakim@gmail.com'  AND p.code = 'hakim-boucheniata-riad-1')
    )
    AND p.is_preparation = true
    AND p.deleted_at IS NULL;

  RAISE NOTICE 'Migration terminée avec succès.';
END $$;

-- ─── Vérification post-migration ───────────────────────────────────────────
SELECT
  '📊 État final' AS info,
  (SELECT COUNT(*) FROM projects WHERE status = 'termine' AND deleted_at IS NULL) AS nb_termine,
  (SELECT COUNT(*) FROM projects WHERE status = 'actif' AND deleted_at IS NULL) AS nb_actif,
  (SELECT COUNT(*) FROM projects WHERE status = 'pause' AND deleted_at IS NULL) AS nb_pause,
  (SELECT COUNT(*) FROM projects WHERE status = 'perdu' AND deleted_at IS NULL) AS nb_perdu_restant,
  (SELECT COUNT(*) FROM projects WHERE is_preparation = true AND deleted_at IS NULL) AS nb_en_preparation;
