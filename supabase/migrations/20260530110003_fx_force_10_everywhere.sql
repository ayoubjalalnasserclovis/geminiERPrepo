-- ════════════════════════════════════════════════════════════════════════════
-- #6 (règle ULTIME) — 10 DH = 1 € PARTOUT.
-- On force le taux de change à 10 sur toutes les transactions MAD->EUR,
-- existantes ET futures. Plus aucun taux réel par transaction : une seule règle.
-- (amount_total_eur, colonne générée = amount_total / exchange_rate_eur, devient /10.)
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Forcer le taux sur les lignes existantes (recalcule amount_total_eur = montant / 10)
UPDATE travaux_payments SET exchange_rate_eur = 10 WHERE exchange_rate_eur IS DISTINCT FROM 10;
UPDATE achats_payments  SET exchange_rate_eur = 10 WHERE exchange_rate_eur IS DISTINCT FROM 10;

-- 2) Défaut à 10 pour les nouvelles lignes
ALTER TABLE travaux_payments ALTER COLUMN exchange_rate_eur SET DEFAULT 10;
ALTER TABLE achats_payments  ALTER COLUMN exchange_rate_eur SET DEFAULT 10;

-- 3) Forcer à 10 quoi qu'il arrive (même si l'app envoie un autre taux)
CREATE OR REPLACE FUNCTION force_fixed_fx_rate()
RETURNS TRIGGER AS $$
BEGIN
  NEW.exchange_rate_eur := 10;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS travaux_payments_force_fx ON travaux_payments;
CREATE TRIGGER travaux_payments_force_fx
  BEFORE INSERT OR UPDATE ON travaux_payments
  FOR EACH ROW EXECUTE FUNCTION force_fixed_fx_rate();

DROP TRIGGER IF EXISTS achats_payments_force_fx ON achats_payments;
CREATE TRIGGER achats_payments_force_fx
  BEFORE INSERT OR UPDATE ON achats_payments
  FOR EACH ROW EXECUTE FUNCTION force_fixed_fx_rate();
