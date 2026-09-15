-- ============================================================================
-- Suppression contrôlée des lignes Propria — journal + validation CEO
-- ----------------------------------------------------------------------------
-- POURQUOI (métier) :
--   Le back office et le terrain doivent pouvoir SUPPRIMER une ligne dans
--   n'importe quel module Propria (tâche, intervention, dépense, réservation…).
--   La suppression est IMMÉDIATE (la ligne disparaît) mais passe ensuite en
--   VALIDATION auprès du CEO : il confirme (définitif) ou restaure.
--   Le CEO, lui, supprime directement (déjà confirmé).
--
-- CANON :
--   - JAMAIS de hard-delete : « supprimer » = poser deleted_at sur la ligne.
--     Toutes les tables Propria ont déjà deleted_at → réversible (restore =
--     remettre deleted_at à NULL).
--   - Audit : chaque suppression est journalisée ici (qui, quoi, quand, motif).
--
-- Idempotent : IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS propria_deletions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table  TEXT NOT NULL,            -- ex 'propria_cash_reservations'
  entity_id     UUID NOT NULL,            -- id de la ligne supprimée
  reason        TEXT,                     -- motif (optionnel)
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','restored')),
  deleted_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by   UUID REFERENCES profiles(id),   -- CEO qui a confirmé/restauré
  resolved_at   TIMESTAMPTZ
);

COMMENT ON TABLE propria_deletions IS
  'Journal des suppressions Propria. status=pending → en attente de validation CEO ; confirmed → suppression validée ; restored → ligne restaurée (deleted_at remis à NULL).';

CREATE INDEX IF NOT EXISTS propria_deletions_pending_idx
  ON propria_deletions (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS propria_deletions_entity_idx
  ON propria_deletions (entity_table, entity_id);

ALTER TABLE propria_deletions ENABLE ROW LEVEL SECURITY;

-- Lecture : back office + CEO voient toute la file ; chacun voit ses demandes.
DROP POLICY IF EXISTS propria_deletions_read ON propria_deletions;
CREATE POLICY propria_deletions_read ON propria_deletions
  FOR SELECT USING (
    is_staff(ARRAY['ceo','chef_projet','assistante'])
    OR deleted_by = auth.uid()
  );

-- Création : back office + terrain, en son propre nom.
DROP POLICY IF EXISTS propria_deletions_insert ON propria_deletions;
CREATE POLICY propria_deletions_insert ON propria_deletions
  FOR INSERT WITH CHECK (
    deleted_by = auth.uid()
    AND is_staff(ARRAY['ceo','chef_projet','assistante','propria'])
  );

-- Validation / restauration : CEO uniquement.
DROP POLICY IF EXISTS propria_deletions_update ON propria_deletions;
CREATE POLICY propria_deletions_update ON propria_deletions
  FOR UPDATE USING (is_staff(ARRAY['ceo']))
  WITH CHECK (is_staff(ARRAY['ceo']));
