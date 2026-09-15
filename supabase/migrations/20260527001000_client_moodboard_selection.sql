-- ============================================================================
-- Phase Design — sélection client de 1 ou 2 moodboards (gate bloquant)
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_moodboard_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES moodboard_templates(id) ON DELETE CASCADE,
  preference_order INTEGER NOT NULL CHECK (preference_order BETWEEN 1 AND 2),
  client_comment TEXT,                  -- commentaire spécifique sur ce moodboard
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, template_id),
  UNIQUE (project_id, preference_order)
);

CREATE INDEX IF NOT EXISTS cms_project_idx ON client_moodboard_selections (project_id);
CREATE INDEX IF NOT EXISTS cms_template_idx ON client_moodboard_selections (template_id);

-- Statut global de la sélection sur le projet (envoyé/validé/etc.)
-- On stocke aussi un commentaire global "côté client" séparé des commentaires par moodboard
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS moodboard_selection_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moodboard_selection_global_comment TEXT;

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE client_moodboard_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cms_staff_all ON client_moodboard_selections;
CREATE POLICY cms_staff_all ON client_moodboard_selections FOR ALL
  USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS cms_client_read ON client_moodboard_selections;
CREATE POLICY cms_client_read ON client_moodboard_selections FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

DROP POLICY IF EXISTS cms_client_insert ON client_moodboard_selections;
CREATE POLICY cms_client_insert ON client_moodboard_selections FOR INSERT
  WITH CHECK (project_id IN (SELECT client_project_ids()));

DROP POLICY IF EXISTS cms_client_delete ON client_moodboard_selections;
CREATE POLICY cms_client_delete ON client_moodboard_selections FOR DELETE
  USING (project_id IN (SELECT client_project_ids()));
