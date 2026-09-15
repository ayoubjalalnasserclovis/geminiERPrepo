-- ============================================================================
-- MIGRATION — WiFi + lock_code des LOTS vers le BIEN
-- ============================================================================
-- Le wifi et le code serrure principale sont identiques sur tous les lots
-- d'un même bien (vérifié : 1 wifi par bien dans nos imports).
-- On les remonte au niveau BIEN (properties) où ils auraient dû être.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_already_applied INT;
BEGIN
  SELECT COUNT(*) INTO v_already_applied FROM data_fix_log
    WHERE fix_name = 'migrate-wifi-lockcode-2026-05-30';
  IF v_already_applied > 0 THEN
    RAISE NOTICE 'Migration déjà appliquée. Skip.';
    RETURN;
  END IF;

  -- Snapshot
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'migrate-wifi-lockcode-2026-05-30', 'properties', p.id::text, to_jsonb(p)
  FROM properties p WHERE p.propria_managed_at IS NOT NULL AND p.deleted_at IS NULL;

  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'migrate-wifi-lockcode-2026-05-30', 'propria_units', u.id::text, to_jsonb(u)
  FROM propria_units u WHERE u.deleted_at IS NULL;

  -- Pour chaque bien Propria : copier wifi/lock_code depuis le 1er lot vers la property
  UPDATE properties p SET
    propria_wifi_ssid = COALESCE(p.propria_wifi_ssid, (
      SELECT u.propria_wifi_ssid FROM propria_units u
      WHERE u.property_id = p.id AND u.deleted_at IS NULL AND u.propria_wifi_ssid IS NOT NULL
      LIMIT 1
    )),
    propria_wifi_password = COALESCE(p.propria_wifi_password, (
      SELECT u.propria_wifi_password FROM propria_units u
      WHERE u.property_id = p.id AND u.deleted_at IS NULL AND u.propria_wifi_password IS NOT NULL
      LIMIT 1
    )),
    propria_lock_code = COALESCE(p.propria_lock_code, (
      SELECT u.propria_lock_code FROM propria_units u
      WHERE u.property_id = p.id AND u.deleted_at IS NULL AND u.propria_lock_code IS NOT NULL
      LIMIT 1
    )),
    updated_at = now()
  WHERE p.propria_managed_at IS NOT NULL AND p.deleted_at IS NULL;

  -- Vider les colonnes sur les lots (source de vérité = property maintenant)
  UPDATE propria_units SET
    propria_wifi_ssid = NULL,
    propria_wifi_password = NULL,
    propria_lock_code = NULL,
    updated_at = now()
  WHERE deleted_at IS NULL;

  RAISE NOTICE '✅ WiFi + lock_code migrés au niveau BIEN.';
END $$;

-- Vérification
SELECT
  '📊 Vérif post-migration' AS section,
  COUNT(*) FILTER (WHERE p.propria_wifi_ssid IS NOT NULL) AS biens_avec_wifi,
  COUNT(*) FILTER (WHERE p.propria_lock_code IS NOT NULL) AS biens_avec_lock,
  (SELECT COUNT(*) FROM propria_units WHERE propria_wifi_ssid IS NOT NULL OR propria_lock_code IS NOT NULL) AS lots_avec_residuel
FROM properties p
WHERE p.propria_managed_at IS NOT NULL AND p.deleted_at IS NULL;

COMMIT;
