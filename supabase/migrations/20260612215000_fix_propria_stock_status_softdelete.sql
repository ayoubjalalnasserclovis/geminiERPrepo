-- ════════════════════════════════════════════════════════════════════════════
-- QA-BUG-001 (S2) — propria_stock_status comptait les mouvements soft-deleted
--
-- Cause racine : deleted_at ajouté à propria_stock_movements le 2026-06-08
-- (20260608150000) pour le module suppressions, mais la vue stock (créée le
-- 2026-05-25) n'a jamais été mise à jour : un mouvement supprimé continuait
-- d'impacter le stock courant, la valeur du stock et les alertes rupture.
-- Constaté en prod : 2 mouvements soft-deleted comptés à tort.
--
-- Fix minimal : filtre WHERE deleted_at IS NULL dans la sous-requête.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW propria_stock_status
  WITH (security_invoker = on) AS
SELECT
  c.id,
  c.reference,
  c.name,
  c.category,
  c.unit,
  c.unit_price_mad,
  c.min_threshold,
  c.default_order_qty,
  c.supplier,
  c.initial_stock,
  COALESCE(m.total_entries, 0)::numeric  AS total_entries,
  COALESCE(m.total_exits, 0)::numeric    AS total_exits,
  (c.initial_stock + COALESCE(m.net_qty, 0))::numeric AS current_stock,
  ((c.initial_stock + COALESCE(m.net_qty, 0)) * COALESCE(c.unit_price_mad, 0))::numeric AS stock_value_mad,
  CASE
    WHEN (c.initial_stock + COALESCE(m.net_qty, 0)) <= 0 THEN 'rupture'
    WHEN (c.initial_stock + COALESCE(m.net_qty, 0)) < c.min_threshold THEN 'alerte'
    ELSE 'ok'
  END AS status,
  GREATEST(0, c.min_threshold - (c.initial_stock + COALESCE(m.net_qty, 0))) AS qty_to_order
FROM propria_consumables c
LEFT JOIN (
  SELECT
    consumable_id,
    SUM(CASE WHEN movement_type = 'entree' THEN quantity ELSE 0 END) AS total_entries,
    SUM(CASE WHEN movement_type = 'sortie' THEN quantity ELSE 0 END) AS total_exits,
    SUM(CASE
      WHEN movement_type = 'entree' THEN quantity
      WHEN movement_type = 'sortie' THEN -quantity
      ELSE quantity
    END) AS net_qty
  FROM propria_stock_movements
  WHERE deleted_at IS NULL            -- ← fix QA-BUG-001
  GROUP BY consumable_id
) m ON m.consumable_id = c.id
WHERE c.is_active = true;
