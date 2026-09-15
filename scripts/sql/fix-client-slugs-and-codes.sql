-- ============================================================================
-- FIX — Nettoyage slugs clients pollués + recalcul codes projets PROPRIA
-- ============================================================================
-- Référence : docs/data-fixes/slug-cleanup-audit.md
--
-- Stratégie :
--   1. Audit (lecture seule) — vérifier avant
--   2. Transaction unique (BEGIN/COMMIT) :
--      a. Crée table data_fix_log si pas là (sauvegarde)
--      b. Snapshot des valeurs actuelles
--      c. DISABLE trigger clients_propagate_rename (évite cascade pourrie)
--      d. UPDATE clients (full_name + slug) pour Hakim et Yassine
--      e. UPDATE projects.code manuels selon nomenclature voulue
--      f. ENABLE trigger
--      g. Vérification post-fix
--
-- Idempotent : skip si déjà appliqué (data_fix_log déjà rempli).
-- ============================================================================

-- ─── BLOC DIAGNOSTIC (lecture seule, à exécuter en premier) ─────────────────

SELECT
  '🔍 Avant fix' AS section,
  c.id AS client_id,
  c.full_name AS full_name_actuel,
  c.slug AS slug_actuel,
  CASE c.email
    WHEN 'boucheniata.hakim@gmail.com' THEN 'BOUCHENIATA Hakim'
    WHEN 'elbadaoui.yassine@hotmail.com' THEN 'EL BADAOUI Yassine'
  END AS full_name_cible,
  CASE c.email
    WHEN 'boucheniata.hakim@gmail.com' THEN 'boucheniata-hakim'
    WHEN 'elbadaoui.yassine@hotmail.com' THEN 'el-badaoui-yassine'
  END AS slug_cible
FROM clients c
WHERE c.email IN ('boucheniata.hakim@gmail.com', 'elbadaoui.yassine@hotmail.com');

-- Codes projets à renommer
SELECT
  '🔍 Codes projets à fixer' AS section,
  p.id AS project_id,
  p.code AS code_actuel,
  pr.propria_internal_code AS bien,
  CASE
    WHEN c.email = 'boucheniata.hakim@gmail.com' AND pr.propria_internal_code = 'AF' THEN 'boucheniata-hakim-af'
    WHEN c.email = 'boucheniata.hakim@gmail.com' AND pr.propria_internal_code = 'MAJO' THEN 'boucheniata-hakim-majo'
    WHEN c.email = 'elbadaoui.yassine@hotmail.com' AND pr.propria_internal_code = 'WARDA' THEN 'el-badaoui-yassine-warda'
    WHEN c.email = 'elbadaoui.yassine@hotmail.com' AND pr.propria_internal_code = 'BADAOUI AF' THEN 'el-badaoui-yassine-badaoui-af'
    WHEN c.email = 'souad.meziane@hotmail.com' AND pr.propria_internal_code = 'PATISSERIE KAWTAR' THEN 'paul-serge-ferreira-patisserie-kawtar'
  END AS code_cible
FROM projects p
JOIN clients c ON c.id = p.client_id
JOIN properties pr ON pr.id = p.property_id
WHERE p.legacy_imported = true
  AND p.deleted_at IS NULL
  AND pr.propria_internal_code IN ('AF', 'MAJO', 'WARDA', 'BADAOUI AF', 'PATISSERIE KAWTAR')
ORDER BY c.full_name, pr.propria_internal_code;

-- ⛔ STOP — Vérifie le diagnostic. Si OK, décommente et exécute le bloc TRANSACTION.

-- ─── BLOC TRANSACTION (exécution) ──────────────────────────────────────────
/*
BEGIN;

-- Crée la table d'audit si nécessaire
CREATE TABLE IF NOT EXISTS data_fix_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_name TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by UUID REFERENCES profiles(id)
);

DO $$
DECLARE
  v_already_applied INT;
  v_hakim_id UUID;
  v_yassine_id UUID;
BEGIN
  SELECT COUNT(*) INTO v_already_applied FROM data_fix_log
    WHERE fix_name = 'slug-cleanup-2026-05-30';
  IF v_already_applied > 0 THEN
    RAISE NOTICE 'Fix déjà appliqué (% lignes dans data_fix_log). Skip.', v_already_applied;
    RETURN;
  END IF;

  SELECT id INTO v_hakim_id FROM clients WHERE email = 'boucheniata.hakim@gmail.com';
  SELECT id INTO v_yassine_id FROM clients WHERE email = 'elbadaoui.yassine@hotmail.com';

  -- 1. Snapshot des clients Hakim + Yassine
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'slug-cleanup-2026-05-30', 'clients', c.id::text, to_jsonb(c)
  FROM clients c WHERE c.id IN (v_hakim_id, v_yassine_id);

  -- 2. Snapshot des projets à renommer
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'slug-cleanup-2026-05-30', 'projects', p.id::text, to_jsonb(p)
  FROM projects p
  JOIN properties pr ON pr.id = p.property_id
  WHERE p.legacy_imported = true AND p.deleted_at IS NULL
    AND pr.propria_internal_code IN ('AF', 'MAJO', 'WARDA', 'BADAOUI AF', 'PATISSERIE KAWTAR');

  -- 3. DISABLE trigger
  ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename;

  -- 4. UPDATE clients (full_name + slug)
  UPDATE clients SET full_name = 'BOUCHENIATA Hakim', slug = 'boucheniata-hakim'
    WHERE id = v_hakim_id;
  UPDATE clients SET full_name = 'EL BADAOUI Yassine', slug = 'el-badaoui-yassine'
    WHERE id = v_yassine_id;

  -- 5. UPDATE projects.code manuels
  UPDATE projects SET code = 'boucheniata-hakim-af'
    WHERE legacy_imported = true AND deleted_at IS NULL
      AND property_id = (SELECT id FROM properties WHERE propria_internal_code = 'AF' AND deleted_at IS NULL);

  UPDATE projects SET code = 'boucheniata-hakim-majo'
    WHERE legacy_imported = true AND deleted_at IS NULL
      AND property_id = (SELECT id FROM properties WHERE propria_internal_code = 'MAJO' AND deleted_at IS NULL);

  UPDATE projects SET code = 'el-badaoui-yassine-warda'
    WHERE legacy_imported = true AND deleted_at IS NULL
      AND property_id = (SELECT id FROM properties WHERE propria_internal_code = 'WARDA' AND deleted_at IS NULL);

  UPDATE projects SET code = 'el-badaoui-yassine-badaoui-af'
    WHERE legacy_imported = true AND deleted_at IS NULL
      AND property_id = (SELECT id FROM properties WHERE propria_internal_code = 'BADAOUI AF' AND deleted_at IS NULL);

  UPDATE projects SET code = 'paul-serge-ferreira-patisserie-kawtar'
    WHERE legacy_imported = true AND deleted_at IS NULL
      AND property_id = (SELECT id FROM properties WHERE propria_internal_code = 'PATISSERIE KAWTAR' AND deleted_at IS NULL);

  -- 6. RE-ENABLE trigger
  ALTER TABLE clients ENABLE TRIGGER clients_propagate_rename;

  RAISE NOTICE '✅ Fix appliqué : 2 clients renommés + 5 codes projets corrigés';
END $$;

-- Vérification post-fix
SELECT
  '✅ Post-fix' AS section,
  c.email,
  c.full_name,
  c.slug
FROM clients c
WHERE c.email IN ('boucheniata.hakim@gmail.com', 'elbadaoui.yassine@hotmail.com')
ORDER BY c.email;

SELECT
  '✅ Codes projets post-fix' AS section,
  p.code,
  pr.propria_internal_code AS bien,
  c.full_name AS owner
FROM projects p
JOIN clients c ON c.id = p.client_id
JOIN properties pr ON pr.id = p.property_id
WHERE p.legacy_imported = true AND p.deleted_at IS NULL
  AND pr.propria_internal_code IN ('AF', 'MAJO', 'WARDA', 'BADAOUI AF', 'PATISSERIE KAWTAR')
ORDER BY c.full_name, pr.propria_internal_code;

COMMIT;
*/

-- ─── ROLLBACK (en cas de souci, à décommenter SI besoin uniquement) ────────
/*
BEGIN;
UPDATE clients c
SET full_name = (l.snapshot->>'full_name'),
    slug = (l.snapshot->>'slug')
FROM data_fix_log l
WHERE l.entity = 'clients' AND l.entity_id = c.id::text
  AND l.fix_name = 'slug-cleanup-2026-05-30';

UPDATE projects p
SET code = (l.snapshot->>'code')
FROM data_fix_log l
WHERE l.entity = 'projects' AND l.entity_id = p.id::text
  AND l.fix_name = 'slug-cleanup-2026-05-30';

DELETE FROM data_fix_log WHERE fix_name = 'slug-cleanup-2026-05-30';
COMMIT;
*/
