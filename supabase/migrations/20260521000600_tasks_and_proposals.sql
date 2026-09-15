-- ============================================================================
-- 06 — Tasks, task_templates, property_proposals
-- ============================================================================

CREATE TABLE task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase project_phase NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  default_assigned_role TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER task_templates_set_updated_at BEFORE UPDATE ON task_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  template_id UUID REFERENCES task_templates(id),
  phase project_phase,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','blocked')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES profiles(id),
  is_auto_generated BOOLEAN NOT NULL DEFAULT false,
  is_blocking BOOLEAN NOT NULL DEFAULT true,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'done' AND completed_at IS NOT NULL)
    OR (status <> 'done' AND completed_at IS NULL)
  ),
  CHECK (project_id IS NOT NULL OR partner_id IS NOT NULL)
);

CREATE INDEX tasks_assigned_status_idx ON tasks (assigned_to, status);
CREATE INDEX tasks_project_phase_idx ON tasks (project_id, phase) WHERE project_id IS NOT NULL;
CREATE INDEX tasks_partner_idx ON tasks (partner_id) WHERE partner_id IS NOT NULL;

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── property_proposals ─────────────────────────────────────────────────────
CREATE TABLE property_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by UUID REFERENCES profiles(id),
  viewed_at TIMESTAMPTZ,

  client_response TEXT NOT NULL DEFAULT 'pending'
    CHECK (client_response IN ('pending','accepted','refused','more_info')),
  client_response_at TIMESTAMPTZ,
  client_refusal_reason TEXT,
  client_message TEXT,

  property_snapshot JSONB NOT NULL,
  financial_snapshot JSONB NOT NULL
);

CREATE UNIQUE INDEX proposals_uniq_per_day
  ON property_proposals (project_id, property_id, ((sent_at AT TIME ZONE 'UTC')::date));

CREATE INDEX proposals_project_idx ON property_proposals (project_id, sent_at DESC);
CREATE INDEX proposals_property_idx ON property_proposals (property_id);
