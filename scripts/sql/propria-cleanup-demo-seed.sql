-- ============================================================================
-- CLEANUP — Données seed demo PROPRIA en prod
-- ============================================================================
-- Le seed supabase/seeds/demo_seed_propria.sql a été exécuté en prod par
-- erreur (probablement via SQL editor). Il a créé des biens fictifs (Andre
-- Fortin, Fatima Benkirane, Catherine Dupond, Famille Duc, Habib Sellami,
-- etc.) avec le marker `[PROPRIA-DEMO]` dans propria_observations.
--
-- Ce script est DIRECTEMENT extrait du cleanup natif du seed
-- (lignes 7-32 de demo_seed_propria.sql).
--
-- ⚠ EXÉCUTER LE BLOC DIAGNOSTIC EN PREMIER, vérifier les chiffres,
--   puis exécuter le bloc CLEANUP après validation Othmane.
-- ============================================================================

-- ─── DIAGNOSTIC (lecture seule, à exécuter en premier) ──────────────────────

SELECT
  '🔍 Diagnostic seed démo' AS section,
  (SELECT COUNT(*) FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%')                           AS nb_properties_demo,
  (SELECT COUNT(*) FROM propria_units u JOIN properties p ON p.id = u.property_id
   WHERE p.propria_observations LIKE '[PROPRIA-DEMO]%')                                                          AS nb_units_demo,
  (SELECT COUNT(*) FROM propria_interventions WHERE observations LIKE '[PROPRIA-DEMO]%')                         AS nb_interventions_demo,
  (SELECT COUNT(*) FROM propria_wallets WHERE notes LIKE '[PROPRIA-DEMO]%')                                      AS nb_wallets_demo,
  (SELECT COUNT(*) FROM propria_inventories WHERE notes LIKE '[PROPRIA-DEMO]%')                                  AS nb_inventories_demo,
  (SELECT COUNT(*) FROM propria_providers WHERE notes LIKE '[PROPRIA-DEMO]%')                                    AS nb_providers_demo,
  (SELECT COUNT(*) FROM propria_consumables WHERE notes LIKE '[PROPRIA-DEMO]%')                                  AS nb_consumables_demo,
  (SELECT COUNT(*) FROM propria_listing_metrics WHERE notes LIKE '[PROPRIA-DEMO]%')                              AS nb_metrics_demo;

-- Liste détaillée des biens demo à supprimer
SELECT
  '🗑 Biens demo à supprimer' AS section,
  p.id,
  p.propria_internal_code AS code,
  p.name,
  p.propria_owner_name AS owner,
  p.created_at::date,
  -- A-t-il un projet lié ? (= bien externe pur, sans achat Stoniz)
  EXISTS (SELECT 1 FROM projects WHERE property_id = p.id AND deleted_at IS NULL) AS a_projet_lie
FROM properties p
WHERE p.propria_observations LIKE '[PROPRIA-DEMO]%'
ORDER BY p.propria_internal_code;

-- ============================================================================
-- ⛔ STOP — Vérifie le diagnostic ci-dessus. Si le résultat te paraît cohérent
--    (5 biens fictifs Andre/Fatima/Catherine Dupond/Famille Duc/Habib +
--    leurs satellites), décommente et exécute le bloc CLEANUP ci-dessous.
-- ============================================================================

-- ─── CLEANUP (transaction unique, exécution destructive) ────────────────────
/*
BEGIN;

-- Ordre des DELETE = inverse des dépendances FK
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
DELETE FROM propria_maintenance_visits
  WHERE property_id IN (SELECT id FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%');
DELETE FROM propria_interventions     WHERE observations LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_providers         WHERE notes LIKE '[PROPRIA-DEMO]%';

-- Supprimer aussi les propria_units des biens demo
DELETE FROM propria_units
  WHERE property_id IN (
    SELECT id FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%'
  );

-- Biens externes demo (pas liés à un projet Stoniz)
DELETE FROM properties
  WHERE propria_observations LIKE '[PROPRIA-DEMO]%'
    AND id NOT IN (SELECT property_id FROM projects WHERE property_id IS NOT NULL);

-- Désactiver Propria sur les biens Stoniz qui auraient été tagués demo
-- (sécurité : on enlève juste le drapeau, on garde la property)
UPDATE properties
  SET propria_managed_at = NULL,
      propria_observations = NULL
  WHERE propria_observations LIKE '[PROPRIA-DEMO]%';

-- Vérification post-cleanup
SELECT
  '✅ Post-cleanup' AS section,
  (SELECT COUNT(*) FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%') AS nb_properties_restantes,
  (SELECT COUNT(*) FROM properties WHERE propria_managed_at IS NOT NULL AND deleted_at IS NULL) AS nb_propria_total;

COMMIT;
*/
