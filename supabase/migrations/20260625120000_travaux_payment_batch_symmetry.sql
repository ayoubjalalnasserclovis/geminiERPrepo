-- Symétrie BDD travaux ↔ achats pour la demande de paiement multi-lots
-- (CEO 2026-06-25 Phase B1). Référence : 20260609100000_achats_payment_batch.sql
--
-- Contexte : `achats_payments` a déjà `payment_batch_id` + `supplier_id` FK. Côté
-- travaux, on n'a que `artisan_name` (texte) et aucun batch — impossible de
-- créer une demande de paiement groupée. Cette migration aligne les deux
-- modèles pour que `requestPaymentForExistingAcomptesAction` puisse fonctionner
-- de manière strictement symétrique (cf. canon `stoniz_canon_travaux_achats`).

-- 1. payment_batch_id sur travaux_payments
ALTER TABLE travaux_payments
  ADD COLUMN IF NOT EXISTS payment_batch_id uuid;

CREATE INDEX IF NOT EXISTS travaux_payments_payment_batch_id_idx
  ON travaux_payments (payment_batch_id)
  WHERE payment_batch_id IS NOT NULL AND deleted_at IS NULL;

-- 2. artisan_id sur travaux_payments (FK vers artisans)
ALTER TABLE travaux_payments
  ADD COLUMN IF NOT EXISTS artisan_id uuid REFERENCES artisans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS travaux_payments_artisan_id_idx
  ON travaux_payments (artisan_id)
  WHERE artisan_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN travaux_payments.payment_batch_id IS
  'UUID de regroupement pour demande paiement multi-acomptes (1 batch = 1 artisan). Symétrie avec achats_payments.payment_batch_id.';
COMMENT ON COLUMN travaux_payments.artisan_id IS
  'FK artisan (groupage serveur fiable). Si NULL, fallback sur artisan_name texte.';

-- 3. Backfill artisan_id pour les travaux_payments existants quand possible (best-effort)
UPDATE travaux_payments tp
SET artisan_id = a.id
FROM artisans a
WHERE tp.artisan_id IS NULL
  AND tp.artisan_name IS NOT NULL
  AND a.deleted_at IS NULL
  AND LOWER(TRIM(a.name)) = LOWER(TRIM(tp.artisan_name));

-- 4. PostgREST : recharger le schema cache
NOTIFY pgrst, 'reload schema';
