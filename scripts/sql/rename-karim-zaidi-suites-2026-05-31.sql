-- ============================================================================
-- Renommer les 3 suites Karim : zaidi-karim-N → ZAIDI N (convention business)
-- Décision CEO 2026-05-31 : tous les codes propria_units suivent la convention
-- "NOM_FAMILLE_MAJ N" (ex: ZAIDI 1, ZAIDI 2, ZAIDI 3, WARDA 1, YAMINA 2...)
-- Idempotent + audit data_fix_log.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_already INT;
  v_renamed INT := 0;
BEGIN
  SELECT COUNT(*) INTO v_already FROM data_fix_log
    WHERE fix_name = 'rename-karim-zaidi-suites-2026-05-31';
  IF v_already > 0 THEN
    RAISE NOTICE 'Deja applique. Skip.';
    RETURN;
  END IF;

  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'rename-karim-zaidi-suites-2026-05-31', 'propria_units', pu.id::text, to_jsonb(pu)
    FROM propria_units pu
   WHERE pu.code LIKE 'zaidi-karim-%'
     AND pu.deleted_at IS NULL;

  UPDATE propria_units
     SET code = 'ZAIDI ' || order_index::text,
         updated_at = now()
   WHERE code LIKE 'zaidi-karim-%'
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  RAISE NOTICE 'Renomme % suites Karim Zaidi', v_renamed;
END $$;

SELECT 'Verif' AS section,
  (SELECT COUNT(*) FROM propria_units WHERE code LIKE 'zaidi-karim-%' AND deleted_at IS NULL) AS karim_restants,
  (SELECT array_agg(code ORDER BY order_index)
     FROM propria_units WHERE code LIKE 'ZAIDI %' AND deleted_at IS NULL) AS nouveaux_codes;

COMMIT;
