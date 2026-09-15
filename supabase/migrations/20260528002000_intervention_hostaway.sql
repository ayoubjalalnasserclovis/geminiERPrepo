-- ============================================================================
-- Suivi de l'intégration Hostaway pour chaque intervention Propria.
-- Permet de tracer si l'intervention a été remontée dans Hostaway (CRM PMS).
-- ============================================================================

ALTER TABLE propria_interventions
  ADD COLUMN IF NOT EXISTS hostaway_integrated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN propria_interventions.hostaway_integrated IS
  'L''intervention a-t-elle été intégrée / remontée dans Hostaway ?';

CREATE INDEX IF NOT EXISTS propria_interventions_hostaway_idx
  ON propria_interventions (hostaway_integrated) WHERE deleted_at IS NULL;
