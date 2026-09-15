-- ============================================================================
-- Accès lecture seule des lots (propria_units) pour le rôle terrain `propria`
-- ----------------------------------------------------------------------------
-- POURQUOI (métier) :
--   Les tâches terrain pointent désormais sur un lot (propria_unit_id). L'écran
--   « Mes tâches » du terrain doit afficher le libellé du lot concerné
--   (ex « bennani-2 »). Or la politique propria_units_staff_all ne couvre que
--   le back office — le rôle `propria` ne pouvait pas lire les lots, donc le
--   libellé tombait en « Bien » générique.
--
--   On ajoute une politique LECTURE SEULE pour `propria`. Le terrain ne peut
--   pas créer/modifier/supprimer un lot (ça reste réservé au back office).
--
-- Idempotent : DROP ... IF EXISTS + CREATE.
-- ============================================================================

DROP POLICY IF EXISTS propria_units_field_read ON propria_units;
CREATE POLICY propria_units_field_read ON propria_units
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'propria'
        AND profiles.is_active = true
    )
  );
