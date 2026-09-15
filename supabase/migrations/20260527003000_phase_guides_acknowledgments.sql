-- ============================================================================
-- Gates phase guides : à chaque transition de phase, le client doit lire
-- et acquitter un guide expliquant la phase + risques + protocoles.
-- ============================================================================

CREATE TABLE IF NOT EXISTS phase_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase project_phase NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by UUID REFERENCES profiles(id),
  ip_address INET,
  user_agent TEXT,
  UNIQUE (project_id, phase)
);

CREATE INDEX IF NOT EXISTS pa_project_idx ON phase_acknowledgments (project_id);

-- RLS
ALTER TABLE phase_acknowledgments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pa_staff_all ON phase_acknowledgments;
CREATE POLICY pa_staff_all ON phase_acknowledgments FOR ALL
  USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS pa_client_read ON phase_acknowledgments;
CREATE POLICY pa_client_read ON phase_acknowledgments FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

DROP POLICY IF EXISTS pa_client_insert ON phase_acknowledgments;
CREATE POLICY pa_client_insert ON phase_acknowledgments FOR INSERT
  WITH CHECK (project_id IN (SELECT client_project_ids()));
