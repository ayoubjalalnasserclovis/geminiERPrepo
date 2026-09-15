-- ============================================================================
-- ACHATS — Extension achats_lots : suite + quantité + collaborateur
-- ============================================================================
-- Règle métier (CEO 2026-05-30) :
--   - Stoniz divise chaque bien en N suites locatives (propria_units)
--   - Chaque achat doit pouvoir être rattaché soit à UNE suite, soit au bien
--     global (parties communes, déco hall) → propria_unit_id nullable
--   - On garde la logique quantité × prix unitaire en plus du budget total
--     (hybride : si Q et PU saisis, budget pré-rempli auto ; sinon budget libre)
--   - Le collaborateur qui passe l'achat doit être traçable (FK profiles)
--
-- 4 nouvelles colonnes, toutes nullables → aucune ligne existante n'est cassée.
-- ============================================================================

BEGIN;

ALTER TABLE achats_lots
  ADD COLUMN IF NOT EXISTS propria_unit_id  UUID NULL REFERENCES propria_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity         NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS unit_price_mad   NUMERIC(14,2) NULL,
  ADD COLUMN IF NOT EXISTS collaborator_id  UUID NULL REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN achats_lots.propria_unit_id IS
  'Suite locative à laquelle l''achat est rattaché. NULL = bien global (parties communes).';
COMMENT ON COLUMN achats_lots.quantity IS
  'Quantité achetée (info pure, calcul budget = quantity × unit_price_mad si remplis).';
COMMENT ON COLUMN achats_lots.unit_price_mad IS
  'Prix unitaire MAD (info pure). Si saisi avec quantity, prefill budget_estimate_mad.';
COMMENT ON COLUMN achats_lots.collaborator_id IS
  'Membre de l''équipe Stoniz qui a passé l''achat (FK profiles).';

CREATE INDEX IF NOT EXISTS achats_lots_unit_idx
  ON achats_lots (propria_unit_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS achats_lots_collaborator_idx
  ON achats_lots (collaborator_id) WHERE deleted_at IS NULL;

COMMIT;
