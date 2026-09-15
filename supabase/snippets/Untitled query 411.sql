CREATE TABLE IF NOT EXISTS project_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id),
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'note' CHECK (category IN (
    'note','appel','reunion','suivi_chantier','interne','client','partenaire','alerte'
  )),
  pinned BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_notes_project_idx
  ON project_notes (project_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER project_notes_set_updated_at BEFORE UPDATE ON project_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_notes_staff ON project_notes;
CREATE POLICY project_notes_staff ON project_notes
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

NOTIFY pgrst, 'reload schema';