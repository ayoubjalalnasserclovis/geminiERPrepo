-- ============================================================================
-- Contraintes UNIQUE partielles sur bank_transaction_allocations
-- ============================================================================
--
-- Empêche 2 allocations bancaires actives de pointer vers la MÊME
-- ligne finance (travaux_encaissement / achats_encaissement / travaux_payment /
-- achats_payment / services_payment / payment).
--
-- Sémantique métier : 1 allocation banque = 1 ligne finance (relation 1-to-1).
-- Cette contrainte matérialise l'invariant côté BDD, en complément du
-- garde-fou applicatif dans attachToStonizPaymentAction (ligne 1235+ de
-- app/(team)/finance/tresorerie/transactions/actions.ts).
--
-- Bug diagnostiqué CEO 2026-07-02 sur Yassine El Faiq (project_id
-- a313063e-2774-4934-880c-a3f41b5477f4) : 3 virements 50k MAD avaient été
-- rapprochés successivement au même travaux_encaissement fe75e878-...
-- → la page travaux affichait 1 encaissement 50k au lieu de 3 encaissements
-- pour 150k au total.
--
-- ⚠️ AVANT D'APPLIQUER : vérifier qu'il n'y a AUCUN doublon actif restant :
--
--   SELECT travaux_encaissement_id, COUNT(*)
--   FROM bank_transaction_allocations
--   WHERE deleted_at IS NULL AND travaux_encaissement_id IS NOT NULL
--   GROUP BY 1 HAVING COUNT(*) > 1;
--
--   -- Idem pour achats_encaissement_id, travaux_payment_id, achats_payment_id,
--   -- services_payment_id, payment_id.
--
-- Si un résultat > 0 → STOP, lancer d'abord la migration de data fix
-- (déduplication des allocations orphelines / création des encaissements
-- manquants) avant d'appliquer cette migration.
-- ============================================================================

-- ⚠️ Décision produit audit 2026-07-02 (sub-agent B) : NE PAS mettre UNIQUE
-- sur travaux_payment_id ni achats_payment_id — sémantique légitime observée
-- où un payment peut être soldé par plusieurs transactions banque (ex:
-- STZ-2026-077 payment split entre 2 transactions ; STZ-2026-085 / 116 avec
-- rapprochements multi-transactions notés explicitement).
-- Seuls les ENCAISSEMENTS (recettes) sont strictement 1-to-1 :
-- travaux_encaissement_id, achats_encaissement_id, services_payment_id.

CREATE UNIQUE INDEX IF NOT EXISTS unique_alloc_travaux_encaissement
  ON public.bank_transaction_allocations (travaux_encaissement_id)
  WHERE deleted_at IS NULL AND travaux_encaissement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_alloc_achats_encaissement
  ON public.bank_transaction_allocations (achats_encaissement_id)
  WHERE deleted_at IS NULL AND achats_encaissement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_alloc_services_payment
  ON public.bank_transaction_allocations (services_payment_id)
  WHERE deleted_at IS NULL AND services_payment_id IS NOT NULL;

COMMENT ON INDEX public.unique_alloc_travaux_encaissement IS
  '1 encaissement travaux ne peut être lié qu''à 1 seule allocation banque active. Bug fix CEO 2026-07-02.';
COMMENT ON INDEX public.unique_alloc_achats_encaissement IS
  '1 encaissement achats ne peut être lié qu''à 1 seule allocation banque active. Bug fix CEO 2026-07-02.';
COMMENT ON INDEX public.unique_alloc_services_payment IS
  '1 payment services ne peut être lié qu''à 1 seule allocation banque active. Bug fix CEO 2026-07-02.';

-- ─── Réversibilité ──────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS public.unique_alloc_travaux_encaissement;
-- DROP INDEX IF EXISTS public.unique_alloc_achats_encaissement;
-- DROP INDEX IF EXISTS public.unique_alloc_services_payment;
