-- ============================================================================
-- 1. Bookmarks projets (etoiles personnelles)
-- 2. Templates moodboard 3D + choix client
-- ============================================================================

-- ─── 1. Project bookmarks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS project_bookmarks_user_idx
  ON project_bookmarks (user_id, created_at DESC);

ALTER TABLE project_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookmarks_owner_all ON project_bookmarks;
CREATE POLICY bookmarks_owner_all ON project_bookmarks FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── 2. Moodboard templates (catalogue Stoniz) ────────────────────────────
CREATE TABLE IF NOT EXISTS moodboard_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  style TEXT NOT NULL CHECK (style IN (
    'oriental_traditionnel','oriental_moderne','contemporain_minimaliste',
    'scandinave','industriel','boheme','luxe_marocain','tropical','art_deco'
  )),
  description TEXT,
  cover_image_url TEXT,            -- URL publique d'une image cover
  inspirations_urls TEXT[] DEFAULT '{}',   -- URLs Pinterest / images d'inspiration
  tags TEXT[] DEFAULT '{}',         -- ex: ['zellige','laiton','olivier']
  palette_colors TEXT[] DEFAULT '{}',  -- ex: ['#C9A063','#1A3A52','#F5F1EB']
  budget_indicatif_eur_per_m2 NUMERIC(8,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moodboard_templates_active_idx
  ON moodboard_templates (is_active, display_order) WHERE is_active = true;

-- ─── 3. Choix moodboard par projet ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_moodboard_choices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  template_id UUID REFERENCES moodboard_templates(id) ON DELETE SET NULL,
  custom_notes TEXT,                     -- adaptations specifiques client
  custom_inspirations_urls TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent_to_client','validated','rejected'
  )),
  selected_by UUID REFERENCES profiles(id),
  validated_by_client_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS moodboard_templates_set_updated_at ON moodboard_templates;
CREATE TRIGGER moodboard_templates_set_updated_at BEFORE UPDATE ON moodboard_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pmc_set_updated_at ON project_moodboard_choices;
CREATE TRIGGER pmc_set_updated_at BEFORE UPDATE ON project_moodboard_choices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE moodboard_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moodboards_read_all ON moodboard_templates;
CREATE POLICY moodboards_read_all ON moodboard_templates FOR SELECT USING (true);
DROP POLICY IF EXISTS moodboards_write_staff ON moodboard_templates;
CREATE POLICY moodboards_write_staff ON moodboard_templates FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','marketing']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','marketing']));

ALTER TABLE project_moodboard_choices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pmc_staff_all ON project_moodboard_choices;
CREATE POLICY pmc_staff_all ON project_moodboard_choices FOR ALL
  USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS pmc_client_read ON project_moodboard_choices;
CREATE POLICY pmc_client_read ON project_moodboard_choices FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));
DROP POLICY IF EXISTS pmc_client_validate ON project_moodboard_choices;
CREATE POLICY pmc_client_validate ON project_moodboard_choices FOR UPDATE
  USING (project_id IN (SELECT client_project_ids()) AND status = 'sent_to_client')
  WITH CHECK (project_id IN (SELECT client_project_ids()) AND status IN ('validated','rejected'));

-- ─── Seed initial : 9 templates moodboard ────────────────────────────────
INSERT INTO moodboard_templates (name, style, description, palette_colors, tags, budget_indicatif_eur_per_m2, display_order) VALUES
  ('Riad Authentique', 'oriental_traditionnel',
    'Zellige polychrome, plafonds en cèdre sculpté, mobilier en bois patiné. Pour Riads et appartements anciens du quartier Majorelle/médina.',
    ARRAY['#1A3A52','#C9A063','#8B2436','#F5F1EB'],
    ARRAY['zellige','tadelakt','bois cèdre','laiton','poteries','tapis berbère'],
    180, 1),
  ('Marocain Contemporain', 'oriental_moderne',
    'Codes orientaux revisités : zellige géométrique sobre, lignes épurées, touches dorées. Idéal Gueliz / Hivernage.',
    ARRAY['#E8DCC4','#1A1A1A','#C9A063','#FFFFFF'],
    ARRAY['zellige moderne','laiton brossé','marbre','noir mat'],
    220, 2),
  ('Minimaliste Méditerranéen', 'contemporain_minimaliste',
    'Blanc cassé, beiges, lin, pierre brute. Volumes ouverts, peu de mobilier, focus sur la lumière.',
    ARRAY['#F5F1EB','#D4C5A9','#8A7A66','#FFFFFF'],
    ARRAY['enduit chaux','rotin','olivier','toile lin','céramique brute'],
    160, 3),
  ('Scandinave Marrakchi', 'scandinave',
    'Bois clair, blanc, textiles bruts, plantes vertes. Touches d''artisanat berbère pour ancrer le style.',
    ARRAY['#FFFFFF','#E8DCC4','#A89B85','#2E2E2E'],
    ARRAY['chêne clair','rotin','lin écru','plantes','jonc de mer'],
    150, 4),
  ('Industriel Atlas', 'industriel',
    'Béton ciré, acier noir, ampoules apparentes, mobilier vintage. Pour lofts Gueliz.',
    ARRAY['#2E2E2E','#A89B85','#8A4F26','#1A1A1A'],
    ARRAY['béton ciré','acier','cuir cognac','briques apparentes'],
    170, 5),
  ('Bohème Désert', 'boheme',
    'Tapis superposés, coussins multi-textures, macramé, palmiers. Ambiance détendue et chaleureuse.',
    ARRAY['#C9A063','#D4754E','#8B2436','#E8DCC4'],
    ARRAY['tapis kilim','macramé','plantes','poufs','poteries terre cuite'],
    140, 6),
  ('Luxe Marocain', 'luxe_marocain',
    'Marbre travertin, laiton brossé, velours profonds, lustres en cuivre martelé. Penthouse / Riad haut de gamme.',
    ARRAY['#1A1A1A','#C9A063','#5C1F2A','#FFFFFF'],
    ARRAY['marbre','laiton','velours','cristal','cuivre martelé'],
    280, 7),
  ('Tropical Palmeraie', 'tropical',
    'Bois exotique, fibres naturelles, motifs feuillus, palette vert/terracotta. Pour Palmeraie / Targa.',
    ARRAY['#3E5C3A','#D4754E','#E8DCC4','#A89B85'],
    ARRAY['rotin','bambou','feuillage','terracotta','pierre volcanique'],
    175, 8),
  ('Art Déco Hivernage', 'art_deco',
    'Géométries fortes, laiton, marbre noir, velours émeraude. Inspiration années 30 réactualisée.',
    ARRAY['#1F4D3E','#C9A063','#1A1A1A','#F5F1EB'],
    ARRAY['marbre noir','laiton poli','velours émeraude','géométrie'],
    240, 9)
ON CONFLICT DO NOTHING;
