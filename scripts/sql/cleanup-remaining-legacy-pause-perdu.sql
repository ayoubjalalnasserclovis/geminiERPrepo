-- ============================================================================
-- CLEANUP FINAL — 19 projets legacy pause/perdu restants
-- ============================================================================
-- Décisions :
--   - SUPPRIMER tous les 13 perdus restants
--   - SUPPRIMER 6 pause (sauf Inés JABER et Ziad Hassan qu'on garde tels quels)
--   - Inés et Ziad : laissés en pause + is_preparation=true (zero touche)
-- ============================================================================

DO $$
DECLARE
  to_delete UUID[];
  client_ids_to_delete UUID[];
BEGIN
  -- ─── 1. Construire la liste des projets à supprimer ──────────────────────
  SELECT ARRAY_AGG(p.id) INTO to_delete
  FROM projects p
  JOIN clients c ON c.id = p.client_id
  WHERE p.is_preparation = true
    AND p.deleted_at IS NULL
    AND p.status IN ('pause', 'perdu')
    AND lower(c.email) IN (
      -- 6 pause à supprimer (Inés et Ziad exclus)
      'laboflorent64@gmail.com',       -- Aurélien Florent
      'garance@wearedore.com',         -- Garance Doré
      'litibmohamed@yahoo.fr',         -- LITIB Mohamed
      'me@mohombi.com',                -- MOUPONDO Mohombi
      'n.ouchoutta@epmistes.net',      -- OUCHOUTTA Nordine
      'baumgartenthomas@hotmail.fr',   -- Thomas Baumgarten et Mourad
      -- 13 perdus
      'abderrahim_b@hotmail.fr',       -- Abderrahim Boussouf
      'amybennouna@gmail.com',         -- Amina Bennoua
      'bensaid.anas@gmail.com',        -- Anas Bensaid
      'benoit.debonne@gmail.com',      -- Benoit Debonne
      'bilal.reklaoui@gmail.com',      -- Bilal Reklaoui
      'christophe.ratineau@gmail.com', -- Christophe Ratineau
      'jesuisnicolasdavid@gmail.com',  -- DAVID Nicolas
      'messylia14@gmail.com',          -- EL GARBAOUI Majdoline
      'lhassaniahmed10@gmail.com',     -- Lhassani Ahmed
      'guillaume.pag31@gmail.com',     -- PAGES Guillaume
      'bousabbag.souad@orange.fr',     -- Souad Bousabbag
      'dr.tafaghodi@orange.fr',        -- Thomas Tafaghodi
      'yohann.faure17@gmail.com'       -- Yoann Faure
    );

  RAISE NOTICE 'Projets à supprimer : %', COALESCE(array_length(to_delete, 1), 0);

  -- ─── 2. Capturer les client_ids pour cleanup après ───────────────────────
  SELECT ARRAY_AGG(DISTINCT p.client_id) INTO client_ids_to_delete
  FROM projects p
  WHERE p.id = ANY(to_delete);

  -- ─── 3. DELETE des dépendances ───────────────────────────────────────────
  IF to_delete IS NOT NULL AND array_length(to_delete, 1) > 0 THEN
    DELETE FROM documents          WHERE project_id = ANY(to_delete);
    DELETE FROM payments           WHERE project_id = ANY(to_delete);
    DELETE FROM tasks              WHERE project_id = ANY(to_delete);
    DELETE FROM project_phases_history WHERE project_id = ANY(to_delete);
    DELETE FROM project_notes      WHERE project_id = ANY(to_delete);
    DELETE FROM project_briefs     WHERE project_id = ANY(to_delete);
    DELETE FROM property_proposals WHERE project_id = ANY(to_delete);

    DELETE FROM projects WHERE id = ANY(to_delete);
    RAISE NOTICE 'Projets supprimés.';
  END IF;

  -- ─── 4. DELETE des clients orphelins ─────────────────────────────────────
  IF client_ids_to_delete IS NOT NULL AND array_length(client_ids_to_delete, 1) > 0 THEN
    DELETE FROM clients
    WHERE id = ANY(client_ids_to_delete)
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = clients.id);
    RAISE NOTICE 'Clients orphelins supprimés.';
  END IF;

  RAISE NOTICE 'Cleanup terminé.';
END $$;

-- ─── Vérification finale ───────────────────────────────────────────────────
SELECT
  '📊 État final après cleanup' AS info,
  (SELECT COUNT(*) FROM projects WHERE status = 'termine' AND deleted_at IS NULL) AS nb_termine,
  (SELECT COUNT(*) FROM projects WHERE status = 'actif' AND deleted_at IS NULL) AS nb_actif,
  (SELECT COUNT(*) FROM projects WHERE status = 'pause' AND deleted_at IS NULL) AS nb_pause,
  (SELECT COUNT(*) FROM projects WHERE status = 'perdu' AND deleted_at IS NULL) AS nb_perdu_restant,
  (SELECT COUNT(*) FROM projects WHERE is_preparation = true AND deleted_at IS NULL) AS nb_en_preparation;

-- Vérification ciblée : Inés et Ziad doivent encore exister
SELECT
  '✅ Pause conservés' AS info,
  c.full_name,
  c.email,
  p.status,
  p.current_phase
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN ('ines.jaber@outlook.com', 'p.ziadhassan@gmail.com')
  AND p.deleted_at IS NULL;
