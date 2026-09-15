-- ============================================================================
-- 05 — Projects + phases history
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS project_ref_seq;

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  property_id UUID REFERENCES properties(id),
  assigned_chef_projet UUID REFERENCES profiles(id),

  current_phase project_phase NOT NULL DEFAULT 'onboarding',
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','pause','termine','perdu')),
  lost_reason TEXT,
  lost_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,

  onboarding_date DATE,
  compromis_date DATE,
  acte_authentique_date DATE,
  travaux_start_date DATE,
  travaux_end_date DATE,
  livraison_date DATE,

  stoniz_fees_acquisition NUMERIC(14,2),
  stoniz_fees_travaux NUMERIC(14,2),
  stoniz_fees_manual_override NUMERIC(14,2),
  stoniz_reduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  stoniz_fees_final NUMERIC(14,2) GENERATED ALWAYS AS (
    GREATEST(
      COALESCE(stoniz_fees_manual_override,
        COALESCE(stoniz_fees_acquisition, 0) + COALESCE(stoniz_fees_travaux, 0))
      - COALESCE(stoniz_reduction, 0),
      0
    )
  ) STORED,

  travaux_budget NUMERIC(14,2),
  travaux_total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,

  nb_properties_presented INTEGER NOT NULL DEFAULT 0,
  nb_properties_accepted INTEGER NOT NULL DEFAULT 0,
  nb_properties_refused INTEGER NOT NULL DEFAULT 0,

  selected_moodboard TEXT,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_client_idx ON projects (client_id) WHERE deleted_at IS NULL;
CREATE INDEX projects_chef_idx ON projects (assigned_chef_projet) WHERE deleted_at IS NULL;
CREATE INDEX projects_phase_status_idx ON projects (current_phase, status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX projects_property_active_uniq
  ON projects (property_id)
  WHERE deleted_at IS NULL
    AND status IN ('actif','termine')
    AND property_id IS NOT NULL;

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Auto-numérotation projet ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_project_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := 'STZ-' || TO_CHAR(now(), 'YYYY') || '-' ||
                     LPAD(nextval('project_ref_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_set_reference BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION set_project_reference();

-- ─── project_phases_history ─────────────────────────────────────────────────
CREATE TABLE project_phases_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase project_phase NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_days INTEGER GENERATED ALWAYS AS (
    CASE WHEN completed_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400)::INTEGER
      ELSE NULL END
  ) STORED,
  completed_by UUID REFERENCES profiles(id)
);

CREATE INDEX phh_project_idx ON project_phases_history (project_id, started_at);

-- ─── Helper RLS : projets visibles par le client connecté ───────────────────
CREATE OR REPLACE FUNCTION client_project_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT p.id FROM projects p
  JOIN clients c ON c.id = p.client_id
  WHERE c.profile_id = auth.uid() AND p.deleted_at IS NULL;
$$;
