-- ============================================================================
-- PV de réception — tracking des relances client
-- ============================================================================
-- Permet d'envoyer des relances email au client qui n'a pas signé son PV.
-- Cooldown : minimum 24h entre 2 relances pour éviter le spam.
-- ============================================================================

ALTER TABLE project_reception_pvs
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_reception_pvs.last_reminder_sent_at IS
  'Horodatage de la dernière relance email envoyée au client. NULL si jamais relancé.';
COMMENT ON COLUMN project_reception_pvs.reminder_count IS
  'Nombre de relances envoyées (cumul historique). Utile pour repérer les clients qui traînent.';
