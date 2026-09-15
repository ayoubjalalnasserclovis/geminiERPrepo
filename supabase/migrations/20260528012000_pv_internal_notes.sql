-- ============================================================================
-- PV de réception — note interne chef projet (jamais visible client / PDF)
-- ============================================================================
-- Le champ `general_observations` est visible sur le portail client et le PDF.
-- Cette nouvelle colonne est STRICTEMENT interne : tracking, alerte, contexte
-- pour le chef projet, à ne JAMAIS rendre sur les écrans client.
-- ============================================================================

ALTER TABLE project_reception_pvs
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

COMMENT ON COLUMN project_reception_pvs.internal_notes IS
  'Notes internes Stoniz, JAMAIS visibles côté client ni dans le PDF généré. Usage : alertes chef projet, contexte relation client, infos sensibles.';
