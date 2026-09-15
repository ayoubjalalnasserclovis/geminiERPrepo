-- ============================================================================
-- Notes du Daily Stoniz (CEO 2026-07-06)
-- Miroir de propria_daily_notes pour le point quotidien clé-en-main :
-- notes partagées entre tout le staff, cochables (résolu), soft-delete.
-- Les notes non résolues des jours précédents restent affichées → c'est le
-- rappel des actions décidées la veille.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stoniz_daily_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL CHECK (char_length(content) <= 2000),
  created_by_id UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  resolved_by_id UUID REFERENCES profiles(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stoniz_daily_notes_active_idx
  ON stoniz_daily_notes (created_at DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS stoniz_daily_notes_set_updated_at ON stoniz_daily_notes;
CREATE TRIGGER stoniz_daily_notes_set_updated_at BEFORE UPDATE ON stoniz_daily_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE stoniz_daily_notes ENABLE ROW LEVEL SECURITY;

-- Staff uniquement (le portail client ne voit jamais ces notes)
DROP POLICY IF EXISTS stoniz_daily_notes_staff ON stoniz_daily_notes;
CREATE POLICY stoniz_daily_notes_staff ON stoniz_daily_notes
  FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

COMMENT ON TABLE stoniz_daily_notes IS
  'Notes partagées du Daily Stoniz (point quotidien équipe clé-en-main). Staff uniquement.';
