-- Bug : DELETABLE_TABLES (lib/propria/deletable-tables.ts) déclarait 9 tables
-- supprimables via le pattern soft-delete (UPDATE deleted_at = now()), mais
-- 7 de ces tables n'avaient PAS la colonne deleted_at en BDD. Le clic sur le
-- bouton Trash plantait avec « Could not find the 'deleted_at' column ».
--
-- On ajoute la colonne (nullable, default NULL) + un index partiel sur
-- (NULL) pour préserver les perfs des SELECT … WHERE deleted_at IS NULL.

ALTER TABLE public.propria_cash_reservations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_cash_reservations_alive
  ON public.propria_cash_reservations(id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_inventories
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_inventories_alive
  ON public.propria_inventories(id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_listing_metrics
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_listing_metrics_alive
  ON public.propria_listing_metrics(id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_maintenance_visits
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_maintenance_visits_alive
  ON public.propria_maintenance_visits(id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_stock_movements
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_stock_movements_alive
  ON public.propria_stock_movements(id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_transfers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_transfers_alive
  ON public.propria_transfers(id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_wallet_expenses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_propria_wallet_expenses_alive
  ON public.propria_wallet_expenses(id) WHERE deleted_at IS NULL;

-- Rafraîchit le cache schema de PostgREST pour que les actions prennent
-- en compte la nouvelle colonne sans attendre.
NOTIFY pgrst, 'reload schema';
