-- ============================================================================
-- CLEANUP — Renommer les codes propria_units naïfs (suite-N → {slug}-N)
-- ============================================================================
-- Contexte : un bug initial de initializePropriaUnitsAction passait `code: 'suite-N'`
-- à l'INSERT, ce qui empêchait le trigger trg_propria_units_set_code de générer
-- le code propre `{client_slug}-{order_index}`. Ces codes naïfs sont conservés
-- mais incohérents avec la convention métier.
--
-- Ce script :
--   1. Snapshot tous les units à code naïf dans data_fix_log
--   2. Recalcule le bon code via le même algo que le trigger
--      (slug client via property → project → client) + next_available_code
--      pour éviter les collisions sur l'index unique GLOBAL propria_units_code_uniq
--   3. UPDATE le code
--   4. Vérification finale : 0 code naïf restant
--
-- Idempotent. Rollback possible via data_fix_log.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_already INT;
  v_renamed INT := 0;
  v_skipped INT := 0;
  unit RECORD;
  v_slug TEXT;
  v_new_code TEXT;
BEGIN
  SELECT COUNT(*) INTO v_already FROM data_fix_log
    WHERE fix_name = 'rename-propria-units-naive-codes-2026-05-31';
  IF v_already > 0 THEN
    RAISE NOTICE 'Cleanup deja applique (% snapshots). Skip.', v_already;
    RETURN;
  END IF;

  -- Snapshot avant modif
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'rename-propria-units-naive-codes-2026-05-31', 'propria_units', pu.id::text, to_jsonb(pu)
    FROM propria_units pu
   WHERE pu.code LIKE 'suite-%'
     AND pu.deleted_at IS NULL;

  -- Pour chaque unit à code naïf : recalcule via slug client + order_index
  FOR unit IN
    SELECT pu.id, pu.property_id, pu.order_index, pu.code
      FROM propria_units pu
     WHERE pu.code LIKE 'suite-%'
       AND pu.deleted_at IS NULL
     ORDER BY pu.property_id, pu.order_index
  LOOP
    -- Slug client via property → project (le 1er projet trouvé suffit)
    SELECT c.slug INTO v_slug
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.property_id = unit.property_id
       AND p.deleted_at IS NULL
     LIMIT 1;

    IF v_slug IS NULL THEN
      RAISE NOTICE 'Skip unit % (property %) : aucun client trouve', unit.id, unit.property_id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Génère le code via la même fonction que le trigger (gère les collisions)
    v_new_code := next_available_code(
      v_slug || '-' || unit.order_index::text,
      'propria_units',
      'code'
    );

    UPDATE propria_units
       SET code = v_new_code, updated_at = now()
     WHERE id = unit.id;

    RAISE NOTICE 'Renomme % → %', unit.code, v_new_code;
    v_renamed := v_renamed + 1;
  END LOOP;

  RAISE NOTICE 'Renommage termine : % units renommees, % skipped', v_renamed, v_skipped;
END $$;

-- Vérification finale : 0 code naïf restant
SELECT
  'Verif post-cleanup' AS section,
  (SELECT COUNT(*) FROM propria_units WHERE code LIKE 'suite-%' AND deleted_at IS NULL) AS naive_codes_remaining,
  (SELECT COUNT(*) FROM propria_units WHERE deleted_at IS NULL) AS total_units_actifs;

-- Aperçu des codes après renommage
SELECT
  pu.code AS new_code,
  pu.order_index,
  p.name AS property_name
  FROM propria_units pu
  JOIN properties p ON p.id = pu.property_id
 WHERE pu.deleted_at IS NULL
 ORDER BY p.name, pu.order_index;

COMMIT;

-- ─── Rollback (si besoin, dans une transaction séparée) ─────────────────
-- BEGIN;
--   UPDATE propria_units pu
--      SET code = (snapshot->>'code'),
--          updated_at = now()
--     FROM data_fix_log dfl
--    WHERE dfl.fix_name = 'rename-propria-units-naive-codes-2026-05-31'
--      AND dfl.entity = 'propria_units'
--      AND dfl.entity_id = pu.id::text;
--   DELETE FROM data_fix_log WHERE fix_name = 'rename-propria-units-naive-codes-2026-05-31';
-- COMMIT;
