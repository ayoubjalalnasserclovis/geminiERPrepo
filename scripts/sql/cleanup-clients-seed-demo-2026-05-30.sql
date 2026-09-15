-- ============================================================================
-- CLEANUP — Suppression clients seed démo identifiés CEO 2026-05-30
-- ============================================================================
-- Soft-delete des 10 clients de test (Mehdi Bennani, Sophie Laurent, etc.)
-- + cascade sur leurs projets + leurs paiements.
--
-- Idempotent : ne rejoue rien si déjà appliqué.
-- Auditable : snapshot complet dans data_fix_log pour rollback.
-- Non destructif : juste deleted_at = now() partout.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_already INT;
  v_clients_count INT;
  v_projects_count INT;
  v_payments_count INT;
  v_client_ids UUID[] := ARRAY[
    'cc589521-64fe-4add-94bc-2104df047831'::uuid, -- Mehdi Bennani
    'c156f7ab-8ab0-41ab-810a-e75443335fff'::uuid, -- Sophie Laurent
    '7b21cdea-5167-4e9c-ad2c-27d10ffdb5b1'::uuid, -- Marc Dubois
    '79489b43-cb6c-49d7-ba3c-b13fbfaa27a7'::uuid, -- Yasmine El Fassi
    '9a2970fd-c41d-40af-abdc-02accfcb3445'::uuid, -- Pierre Lambert
    'f02d1628-a11a-47aa-a4a1-852d5e165df2'::uuid, -- Julie Moreau
    'e388761f-bf7f-4652-b3c5-3ad2644bc34a'::uuid, -- Karim Tazi
    'a3439333-b5b8-4f77-b8d2-058053398919'::uuid, -- Elodie Petit
    '63b9fd73-a60b-4542-847a-f919ccb9d619'::uuid, -- Thomas Muller
    '2f1da9d8-9664-48e4-bf35-baac6ead274e'::uuid  -- Camille Rousseau
  ];
BEGIN
  SELECT COUNT(*) INTO v_already FROM data_fix_log
    WHERE fix_name = 'cleanup-clients-seed-demo-2026-05-30';
  IF v_already > 0 THEN
    RAISE NOTICE 'Cleanup déjà appliqué (% snapshots). Skip.', v_already;
    RETURN;
  END IF;

  -- ─── 1. Snapshots avant suppression ────────────────────────────────────
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'cleanup-clients-seed-demo-2026-05-30', 'clients', c.id::text, to_jsonb(c)
    FROM clients c
   WHERE c.id = ANY(v_client_ids)
     AND c.deleted_at IS NULL;

  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'cleanup-clients-seed-demo-2026-05-30', 'projects', p.id::text, to_jsonb(p)
    FROM projects p
   WHERE p.client_id = ANY(v_client_ids)
     AND p.deleted_at IS NULL;

  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'cleanup-clients-seed-demo-2026-05-30', 'payments', pay.id::text, to_jsonb(pay)
    FROM payments pay
    JOIN projects p ON p.id = pay.project_id
   WHERE p.client_id = ANY(v_client_ids)
     AND pay.deleted_at IS NULL;

  -- ─── 2. Soft-delete payments (avant les projects pour propreté de l'audit) ──
  UPDATE payments
     SET deleted_at = now(), updated_at = now()
   WHERE project_id IN (SELECT id FROM projects WHERE client_id = ANY(v_client_ids))
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_payments_count = ROW_COUNT;

  -- ─── 3. Soft-delete projects ───────────────────────────────────────────
  UPDATE projects
     SET deleted_at = now(), updated_at = now()
   WHERE client_id = ANY(v_client_ids)
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_projects_count = ROW_COUNT;

  -- ─── 4. Soft-delete clients ────────────────────────────────────────────
  UPDATE clients
     SET deleted_at = now(), updated_at = now()
   WHERE id = ANY(v_client_ids)
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_clients_count = ROW_COUNT;

  RAISE NOTICE '✅ Cleanup terminé : % clients · % projets · % paiements',
    v_clients_count, v_projects_count, v_payments_count;
END $$;

-- ─── Vérification post-cleanup ─────────────────────────────────────────
SELECT
  '📊 Vérif post-cleanup' AS section,
  (SELECT COUNT(*) FROM clients
     WHERE id IN (
       'cc589521-64fe-4add-94bc-2104df047831','c156f7ab-8ab0-41ab-810a-e75443335fff',
       '7b21cdea-5167-4e9c-ad2c-27d10ffdb5b1','79489b43-cb6c-49d7-ba3c-b13fbfaa27a7',
       '9a2970fd-c41d-40af-abdc-02accfcb3445','f02d1628-a11a-47aa-a4a1-852d5e165df2',
       'e388761f-bf7f-4652-b3c5-3ad2644bc34a','a3439333-b5b8-4f77-b8d2-058053398919',
       '63b9fd73-a60b-4542-847a-f919ccb9d619','2f1da9d8-9664-48e4-bf35-baac6ead274e'
     ) AND deleted_at IS NULL) AS clients_seed_restants,
  (SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL) AS total_clients_actifs;

COMMIT;

-- ─── Rollback (à exécuter en transaction séparée si besoin) ────────────
-- BEGIN;
--   UPDATE clients SET deleted_at = NULL, updated_at = now()
--     WHERE id IN (SELECT entity_id::uuid FROM data_fix_log
--                  WHERE fix_name = 'cleanup-clients-seed-demo-2026-05-30'
--                    AND entity = 'clients');
--   UPDATE projects SET deleted_at = NULL, updated_at = now()
--     WHERE id IN (SELECT entity_id::uuid FROM data_fix_log
--                  WHERE fix_name = 'cleanup-clients-seed-demo-2026-05-30'
--                    AND entity = 'projects');
--   UPDATE payments SET deleted_at = NULL, updated_at = now()
--     WHERE id IN (SELECT entity_id::uuid FROM data_fix_log
--                  WHERE fix_name = 'cleanup-clients-seed-demo-2026-05-30'
--                    AND entity = 'payments');
--   DELETE FROM data_fix_log WHERE fix_name = 'cleanup-clients-seed-demo-2026-05-30';
-- COMMIT;
