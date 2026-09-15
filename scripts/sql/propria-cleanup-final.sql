-- ============================================================================
-- CLEANUP FINAL — Données seed démo + projets test
-- ============================================================================
-- Périmètre :
--   1. 15 biens demo PROPRIA (tag [PROPRIA-DEMO])
--   2. 3 projets de test (test-othmane-el-azzouzi, maris-test-ganille,
--      yassine-el-faiq-test) + leurs satellites
--   3. 3 clients de test (Othmane perso, Marius arko, Yassine elfaiq)
--
-- Sécurités :
--   - LOG explicite (RAISE NOTICE) de ce qui sera supprimé
--   - Transaction unique (BEGIN/COMMIT)
--   - Filet : ne supprime PAS un client s'il a un autre projet vivant ailleurs
-- ============================================================================

DO $$
DECLARE
  v_project_ids UUID[];
  v_client_ids UUID[];
  v_property_ids UUID[];
  v_nb_units INT;
  v_nb_payments INT;
BEGIN
  -- ─── 1. IDENTIFIER les projets test ───────────────────────────────────────
  SELECT ARRAY_AGG(p.id) INTO v_project_ids
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id
  WHERE p.deleted_at IS NULL
    AND (
      lower(COALESCE(p.code, '')) LIKE '%test%'
      OR lower(COALESCE(c.full_name, '')) LIKE '%test%'
      OR c.email IN ('othmane@stoniz.co', 'elazouzi.othmane@gmail.com')
      OR lower(c.email) LIKE '%@arko-media.com%'
      OR lower(c.email) LIKE '%yassine.elfaiq%'
    );

  RAISE NOTICE 'Projets test identifiés : %', COALESCE(array_length(v_project_ids, 1), 0);

  -- ─── 2. Délier les properties demo des projets test ──────────────────────
  -- (sinon FK violation au DELETE des properties)
  UPDATE projects SET property_id = NULL
  WHERE id = ANY(v_project_ids);

  -- ─── 3. Identifier les clients liés ──────────────────────────────────────
  SELECT ARRAY_AGG(DISTINCT client_id) INTO v_client_ids
  FROM projects WHERE id = ANY(v_project_ids);

  -- ─── 4. CLEANUP biens demo (tag [PROPRIA-DEMO]) ──────────────────────────
  SELECT ARRAY_AGG(id) INTO v_property_ids
  FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%';

  RAISE NOTICE 'Biens demo identifiés : %', COALESCE(array_length(v_property_ids, 1), 0);

  -- Satellites Propria (dans l'ordre des dépendances FK)
  DELETE FROM propria_inventory_items
    WHERE inventory_id IN (SELECT id FROM propria_inventories WHERE notes LIKE '[PROPRIA-DEMO]%');
  DELETE FROM propria_inventories       WHERE notes LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_listing_metrics   WHERE notes LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_transfers         WHERE comment LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_cash_reservations WHERE observations LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_stock_movements   WHERE notes LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_consumables       WHERE notes LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_wallet_expenses
    WHERE wallet_id IN (SELECT id FROM propria_wallets WHERE notes LIKE '[PROPRIA-DEMO]%');
  DELETE FROM propria_wallet_dotations
    WHERE wallet_id IN (SELECT id FROM propria_wallets WHERE notes LIKE '[PROPRIA-DEMO]%');
  DELETE FROM propria_wallets           WHERE notes LIKE '[PROPRIA-DEMO]%';
  DELETE FROM propria_maintenance_visits WHERE property_id = ANY(v_property_ids);
  DELETE FROM propria_interventions     WHERE observations LIKE '[PROPRIA-DEMO]%';

  -- Délier les providers démo de TOUTES les tables qui les référencent AVANT
  -- le DELETE providers (3 FK : properties, propria_units, propria_interventions)
  UPDATE properties    SET propria_default_provider_id = NULL
    WHERE propria_default_provider_id IN (SELECT id FROM propria_providers WHERE notes LIKE '[PROPRIA-DEMO]%');
  UPDATE propria_units SET propria_default_provider_id = NULL
    WHERE propria_default_provider_id IN (SELECT id FROM propria_providers WHERE notes LIKE '[PROPRIA-DEMO]%');
  UPDATE propria_interventions SET provider_id = NULL
    WHERE provider_id IN (SELECT id FROM propria_providers WHERE notes LIKE '[PROPRIA-DEMO]%');

  DELETE FROM propria_providers         WHERE notes LIKE '[PROPRIA-DEMO]%';

  -- Supprimer les interventions qui pointent vers les units/properties demo
  -- (cas des interventions créées via UI sans marker [PROPRIA-DEMO])
  DELETE FROM propria_interventions
    WHERE property_id = ANY(v_property_ids)
       OR propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));

  -- Idem pour maintenance_visits côté units
  DELETE FROM propria_maintenance_visits
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));

  -- Et pour les autres tables satellites qui pointent vers propria_unit_id
  DELETE FROM propria_listing_metrics
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));
  DELETE FROM propria_inventories
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));
  DELETE FROM propria_stock_movements
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));
  DELETE FROM propria_cash_reservations
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));
  DELETE FROM propria_transfers
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));
  DELETE FROM propria_wallet_expenses
    WHERE propria_unit_id IN (SELECT id FROM propria_units WHERE property_id = ANY(v_property_ids));

  -- propria_units des biens demo
  DELETE FROM propria_units WHERE property_id = ANY(v_property_ids);

  -- Properties demo (toutes maintenant orphelines de projet vivant)
  DELETE FROM properties WHERE id = ANY(v_property_ids);
  RAISE NOTICE 'Biens demo supprimés.';

  -- ─── 5. CLEANUP projets test (satellites + projets) ──────────────────────
  IF v_project_ids IS NOT NULL AND array_length(v_project_ids, 1) > 0 THEN
    DELETE FROM project_lifecycle_transition WHERE project_id = ANY(v_project_ids);
    DELETE FROM documents          WHERE project_id = ANY(v_project_ids);
    DELETE FROM payments           WHERE project_id = ANY(v_project_ids);
    DELETE FROM tasks              WHERE project_id = ANY(v_project_ids);
    DELETE FROM project_phases_history WHERE project_id = ANY(v_project_ids);
    DELETE FROM project_notes      WHERE project_id = ANY(v_project_ids);
    DELETE FROM project_briefs     WHERE project_id = ANY(v_project_ids);
    DELETE FROM property_proposals WHERE project_id = ANY(v_project_ids);

    DELETE FROM projects WHERE id = ANY(v_project_ids);
    RAISE NOTICE 'Projets test supprimés.';
  END IF;

  -- ─── 6. CLEANUP clients test orphelins ───────────────────────────────────
  IF v_client_ids IS NOT NULL AND array_length(v_client_ids, 1) > 0 THEN
    DELETE FROM clients
    WHERE id = ANY(v_client_ids)
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = clients.id);
    RAISE NOTICE 'Clients test orphelins supprimés.';
  END IF;

  RAISE NOTICE 'Cleanup terminé.';
END $$;

-- ─── Vérifications post-cleanup ─────────────────────────────────────────────
SELECT
  '✅ Post-cleanup' AS info,
  (SELECT COUNT(*) FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%') AS biens_demo_restants,
  (SELECT COUNT(*) FROM properties WHERE propria_managed_at IS NOT NULL AND deleted_at IS NULL) AS biens_propria_legitimes,
  (SELECT COUNT(*) FROM projects p LEFT JOIN clients c ON c.id = p.client_id
   WHERE p.deleted_at IS NULL AND (
     lower(COALESCE(p.code, '')) LIKE '%test%'
     OR lower(COALESCE(c.full_name, '')) LIKE '%test%'
     OR c.email IN ('othmane@stoniz.co', 'elazouzi.othmane@gmail.com')
     OR lower(c.email) LIKE '%@arko-media.com%'
     OR lower(c.email) LIKE '%yassine.elfaiq%'
   )) AS projets_test_restants;
