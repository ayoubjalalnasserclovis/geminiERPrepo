-- ============================================================================
-- CLEANUP — Biens orphelins Notion (opportunités sourcing non concrétisées)
-- ============================================================================
-- Critères :
--   - deleted_at IS NULL (encore actifs)
--   - propria_managed_at IS NULL (pas en gestion PROPRIA)
--   - notion_page_id IS NOT NULL (importés Notion)
--   - Pas de projet vivant qui les référence
--
-- Soft-delete (deleted_at = NOW). Rollback possible via data_fix_log.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_already_applied INT;
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_already_applied FROM data_fix_log
    WHERE fix_name = 'cleanup-biens-perdus-orphelins-2026-05-30';
  IF v_already_applied > 0 THEN
    RAISE NOTICE 'Cleanup déjà appliqué (% snapshots). Skip.', v_already_applied;
    RETURN;
  END IF;

  -- Snapshot
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'cleanup-biens-perdus-orphelins-2026-05-30', 'properties', p.id::text, to_jsonb(p)
  FROM properties p
  WHERE p.deleted_at IS NULL
    AND p.propria_managed_at IS NULL
    AND p.notion_page_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM projects pr
      WHERE pr.property_id = p.id AND pr.deleted_at IS NULL
    );

  -- Soft-delete
  UPDATE properties SET deleted_at = now(), updated_at = now()
  WHERE deleted_at IS NULL
    AND propria_managed_at IS NULL
    AND notion_page_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM projects pr
      WHERE pr.property_id = properties.id AND pr.deleted_at IS NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RAISE NOTICE '✅ % biens orphelins soft-deleted', v_count;
END $$;

-- Vérification post-cleanup
SELECT
  '📊 Post-cleanup' AS section,
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NULL) AS biens_actifs_restants,
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NULL AND propria_managed_at IS NOT NULL) AS biens_propria,
  (SELECT COUNT(*) FROM properties p WHERE p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.property_id = p.id AND pr.deleted_at IS NULL)
  ) AS biens_orphelins_restants;

COMMIT;
