-- ============================================================================
-- Property proposals : team note (obligatoire pour nouvelles) + ordre de choix
-- + batch id pour regrouper les propositions envoyées ensemble
-- ============================================================================

ALTER TABLE property_proposals
  ADD COLUMN IF NOT EXISTS team_note TEXT,
  ADD COLUMN IF NOT EXISTS selection_order INTEGER,
  ADD COLUMN IF NOT EXISTS selection_batch_id UUID;

CREATE INDEX IF NOT EXISTS proposals_batch_idx
  ON property_proposals (selection_batch_id, selection_order)
  WHERE selection_batch_id IS NOT NULL;

-- ============================================================================
-- Vue agrégée pour le dashboard satisfaction
-- ============================================================================
CREATE OR REPLACE VIEW satisfaction_dashboard AS
SELECT
  s.id,
  s.project_id,
  s.client_id,
  s.trigger_phase,
  s.sent_at,
  s.completed_at,
  s.global_score,
  s.communication_score,
  s.reactivity_score,
  s.quality_score,
  s.deadline_score,
  s.nps_score,
  s.comment,
  s.nps_comment,
  p.reference AS project_reference,
  p.current_phase,
  c.full_name AS client_name,
  c.email AS client_email,
  pr.full_name AS chef_name,
  -- Délai entre envoi et complétion (heures)
  CASE WHEN s.completed_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (s.completed_at - s.sent_at)) / 3600
    ELSE NULL END AS completion_hours
FROM satisfaction_surveys s
JOIN projects p ON p.id = s.project_id
LEFT JOIN clients c ON c.id = s.client_id
LEFT JOIN profiles pr ON pr.id = p.assigned_chef_projet;

ALTER VIEW satisfaction_dashboard SET (security_invoker = on);
