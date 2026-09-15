-- ============================================================================
-- Notes / journal de suivi par projet (interne staff uniquement)
-- Chaque entree garde l'auteur + date + categorie + statut epingle.
-- Version evoluee du journal Notion (SH 18/05/2026 ...) avec audit trail propre.
-- ============================================================================

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
CREATE INDEX IF NOT EXISTS project_notes_pinned_idx
  ON project_notes (project_id, pinned, created_at DESC) WHERE deleted_at IS NULL AND pinned = true;

DROP TRIGGER IF EXISTS project_notes_set_updated_at ON project_notes;
CREATE TRIGGER project_notes_set_updated_at BEFORE UPDATE ON project_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

-- Staff peut tout faire ; client NE PEUT PAS voir ces notes (internes)
DROP POLICY IF EXISTS project_notes_staff ON project_notes;
CREATE POLICY project_notes_staff ON project_notes
  FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

COMMENT ON TABLE project_notes IS
  'Journal de suivi par projet : appels, reunions, suivi chantier, alertes. Visible staff uniquement.';
