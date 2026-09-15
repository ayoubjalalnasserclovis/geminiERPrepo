-- Rend partielle (WHERE deleted_at IS NULL) les contraintes UNIQUE metier
-- qui ne filtraient pas, pour eviter les conflits de slot avec les soft-deletes.
--
-- Reference : bug Mamoun Zidouh (STZ-2026-077) sur /finance/tresorerie/transactions
-- ou la creation auto d'un lot achats butait sur un soft-delete (numero=89,
-- "Decoration terrasse" supprime le 2026-06-11). Le code calculait
-- MAX(numero) WHERE deleted_at IS NULL = 88, donc next = 89 -> conflit avec
-- la contrainte UNIQUE non partielle achats_lots_project_id_numero_key.
--
-- Pattern deja applique pour payments_one_per_type_per_project
-- (migration 20260623120000_advance_phase_upsert_and_unique.sql) lors du
-- bug Boutira.
--
-- Egalement le cas Paul Benneli (24/06) : propria_units(property_id, order_index)
-- non partielle avait force un workaround (decalage des order_index vers 98/99).
--
-- Pre-check effectue le 2026-06-30 : 0 doublons actifs sur les colonnes ciblees,
-- aucune FK ne reference ces UNIQUE -> DROP CONSTRAINT safe.

-- 1. achats_lots(project_id, numero) - cause directe du bug CEO 2026-06-30
ALTER TABLE achats_lots DROP CONSTRAINT IF EXISTS achats_lots_project_id_numero_key;
CREATE UNIQUE INDEX IF NOT EXISTS achats_lots_project_id_numero_active_uniq
  ON achats_lots (project_id, numero)
  WHERE deleted_at IS NULL;

-- 2. travaux_lots(project_id, numero) - symetrie achats/travaux
ALTER TABLE travaux_lots DROP CONSTRAINT IF EXISTS travaux_lots_project_id_numero_key;
CREATE UNIQUE INDEX IF NOT EXISTS travaux_lots_project_id_numero_active_uniq
  ON travaux_lots (project_id, numero)
  WHERE deleted_at IS NULL;

-- 3. propria_units(property_id, order_index) - cas Paul Benneli (24/06)
ALTER TABLE propria_units DROP CONSTRAINT IF EXISTS propria_units_property_id_order_index_key;
CREATE UNIQUE INDEX IF NOT EXISTS propria_units_property_order_active_uniq
  ON propria_units (property_id, order_index)
  WHERE deleted_at IS NULL;
