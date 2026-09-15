-- ============================================================================
-- email_logs : ajout du statut 'skipped' pour le mode silencieux
-- ============================================================================
-- Permet de loguer les emails qu'on aurait pu envoyer mais qui ont été bloqués
-- par le mode préparation (is_preparation=true ou legacy_imported=true) ou par
-- le kill switch global EMAIL_KILL_SWITCH.
-- ============================================================================

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;
ALTER TABLE email_logs ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('queued','sent','delivered','opened','bounced','complained','failed','skipped'));

COMMENT ON COLUMN email_logs.status IS
  'État de l''envoi. ''skipped'' = envoi bloqué par le mode silencieux (préparation, legacy ou kill switch). Le détail du blocage est dans payload.skip_reason.';
