-- ════════════════════════════════════════════════════════════════════════════
-- #6 — Taux de change interne FIXE : 10 DH = 1 € (règle CEO 2026-05-30)
-- Sert à consolider en euros les montants MAD (travaux, achats, caisses Propria)
-- sur le cockpit/reporting. Volontairement simple et stable (ne suit pas le marché).
-- NB : les transactions individuelles continuent de figer leur propre exchange_rate_eur
--      au moment de la saisie ; cette fonction est pour la CONSOLIDATION agrégée.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION to_eur(amount_mad NUMERIC)
RETURNS NUMERIC AS $$
  SELECT ROUND(COALESCE(amount_mad, 0) / 10.0, 2);
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION to_eur(NUMERIC) IS
  'Consolidation MAD->EUR au taux interne fixe 10 DH = 1 EUR (regle 2026-05-30).';
