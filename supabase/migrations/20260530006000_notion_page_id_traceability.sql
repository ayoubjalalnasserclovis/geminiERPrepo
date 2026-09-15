-- ============================================================================
-- Traçabilité Notion : colonne notion_page_id sur les 4 tables importées
-- ============================================================================
-- Permet l'UPSERT idempotent depuis le script d'import Notion.
--   Chaque ligne Supabase importée garde l'ID de la page Notion source.
--   Le script peut être ré-exécuté sans créer de doublons (ON CONFLICT).
--   En cas de rollback, un simple DELETE WHERE notion_page_id IS NOT NULL
--   isole précisément les données importées.
--
-- L'unicité est partielle (WHERE notion_page_id IS NOT NULL) pour permettre
-- aux lignes non-importées (créées via l'app) de coexister sans contrainte.
-- ============================================================================

ALTER TABLE partners   ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE clients    ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE projects   ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='partners_notion_page_id_uniq') THEN
    CREATE UNIQUE INDEX partners_notion_page_id_uniq ON partners (notion_page_id) WHERE notion_page_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='properties_notion_page_id_uniq') THEN
    CREATE UNIQUE INDEX properties_notion_page_id_uniq ON properties (notion_page_id) WHERE notion_page_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='clients_notion_page_id_uniq') THEN
    CREATE UNIQUE INDEX clients_notion_page_id_uniq ON clients (notion_page_id) WHERE notion_page_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='projects_notion_page_id_uniq') THEN
    CREATE UNIQUE INDEX projects_notion_page_id_uniq ON projects (notion_page_id) WHERE notion_page_id IS NOT NULL;
  END IF;
END$$;

COMMENT ON COLUMN partners.notion_page_id IS
  'ID de la page Notion source pour les rows importées depuis Notion PARTENAIRES. NULL pour les rows créées via l''app.';
COMMENT ON COLUMN properties.notion_page_id IS
  'ID de la page Notion source pour les rows importées depuis Notion BIENS.';
COMMENT ON COLUMN clients.notion_page_id IS
  'ID de la page Notion source pour les rows importées depuis Notion CLIENTS.';
COMMENT ON COLUMN projects.notion_page_id IS
  'ID de la page Notion CLIENTS source (un row Notion CLIENTS = 1 client + 1 projet).';
