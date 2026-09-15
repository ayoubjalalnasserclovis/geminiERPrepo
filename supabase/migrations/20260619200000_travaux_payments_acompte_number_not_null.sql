-- CEO 2026-06-19 — P0 fix : acomptes orphelins (acompte_number=NULL).
--
-- Contexte
--   Bug reproduit en prod : sur la fiche projet Travaux, un acompte créé via
--   "allocation banque" (transactions/actions.ts) ou via "Acompte programmé"
--   depuis projection cashflow (finance/projection/actions.ts) naissait avec
--   acompte_number=NULL. À l'édition (modale "Modifier cet acompte"), le
--   payload renvoyait null → Zod z.coerce.number().int().min(1).max(6)
--   coerce null en 0 → fail "Number must be greater than or equal to 1".
--
-- Étapes appliquées AVANT cette migration
--   1. UPDATE travaux_payments SET acompte_number = next-free-of-lot
--      (13 lignes corrigées, voir data-fix log même date).
--   2. Routes serveur Insert corrigées pour POSER le numéro (trois sites :
--      finance/tresorerie/transactions/actions.ts, finance/projection/actions.ts,
--      projects/[id]/travaux/actions.ts saveAcompteAction fallback).
--
-- Cette migration verrouille définitivement la colonne et garantit l'unicité.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM travaux_payments WHERE acompte_number IS NULL) THEN
    RAISE EXCEPTION 'Aborted : travaux_payments contient encore des acompte_number=NULL. Lancer le data-fix avant la migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM achats_payments WHERE acompte_number IS NULL) THEN
    RAISE EXCEPTION 'Aborted : achats_payments contient encore des acompte_number=NULL.';
  END IF;
END $$;

ALTER TABLE travaux_payments ALTER COLUMN acompte_number SET NOT NULL;
ALTER TABLE achats_payments  ALTER COLUMN acompte_number SET NOT NULL;

-- Index unique partiel : un seul acompte_number par lot ACTIF.
-- Les lignes soft-deleted (deleted_at IS NOT NULL) sont exclues pour permettre
-- la recréation après suppression.
DROP INDEX IF EXISTS travaux_payments_lot_idx;
CREATE UNIQUE INDEX IF NOT EXISTS travaux_payments_lot_acompte_uniq
  ON travaux_payments (lot_id, acompte_number)
  WHERE deleted_at IS NULL AND lot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS achats_payments_lot_acompte_uniq
  ON achats_payments (lot_id, acompte_number)
  WHERE deleted_at IS NULL AND lot_id IS NOT NULL;
