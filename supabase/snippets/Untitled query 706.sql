CREATE TABLE IF NOT EXISTS project_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  property_types TEXT[] NOT NULL DEFAULT '{}',
  quartiers TEXT[] NOT NULL DEFAULT '{}',
  budget_total_max NUMERIC(14,2),
  budget_acquisition_max NUMERIC(14,2),
  budget_travaux_max NUMERIC(14,2),
  budget_deco_max NUMERIC(14,2),
  available_savings NUMERIC(14,2),
  financing_type TEXT CHECK (financing_type IN ('fonds_propres','banque_classique','banque_islamique','mixte')),
  superficie_min NUMERIC(8,2),
  superficie_max NUMERIC(8,2),
  nb_suites_min INTEGER,
  floor_preference TEXT,
  needs_terrace BOOLEAN,
  needs_elevator BOOLEAN,
  needs_parking BOOLEAN,
  needs_pool BOOLEAN,
  needs_view BOOLEAN,
  rental_strategy TEXT CHECK (rental_strategy IN ('courte_duree','moyenne_duree','longue_duree','mixte','indecis')),
  expected_rent_monthly NUMERIC(14,2),
  expected_gross_yield_pct NUMERIC(5,2),
  expected_net_yield_pct NUMERIC(5,2),
  accept_heavy_works BOOLEAN,
  accept_division BOOLEAN,
  delivery_deadline DATE,
  specificities TEXT,
  exclusions TEXT,
  chef_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent_to_client','validated','rejected_by_client')),
  filled_by UUID REFERENCES profiles(id),
  sent_at TIMESTAMPTZ,
  sent_by UUID REFERENCES profiles(id),
  validated_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_briefs_status_idx ON project_briefs (project_id, status);
CREATE TRIGGER project_briefs_set_updated_at BEFORE UPDATE ON project_briefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE project_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brief_staff_all ON project_briefs;
CREATE POLICY brief_staff_all ON project_briefs FOR ALL
  USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS brief_client_read ON project_briefs;
CREATE POLICY brief_client_read ON project_briefs FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

DROP POLICY IF EXISTS brief_client_respond ON project_briefs;
CREATE POLICY brief_client_respond ON project_briefs FOR UPDATE
  USING (project_id IN (SELECT client_project_ids()) AND status = 'sent_to_client')
  WITH CHECK (project_id IN (SELECT client_project_ids()) AND status IN ('validated','rejected_by_client'));

NOTIFY pgrst, 'reload schema';