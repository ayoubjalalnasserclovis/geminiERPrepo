-- ============================================================================
-- 08 — Documents, satisfaction_surveys, email_logs, notifications, scheduled_jobs
-- ============================================================================

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'contrat_mission','compromis','plans_3d','permis_travaux',
    'photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'autre'
  )),
  uploaded_by UUID REFERENCES profiles(id),
  uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('stoniz','client')),
  storage_path TEXT NOT NULL,
  size_bytes BIGINT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'recu' CHECK (status IN ('en_attente','recu','valide')),
  is_visible_to_client BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (project_id IS NOT NULL OR client_id IS NOT NULL)
);

CREATE INDEX documents_project_idx ON documents (project_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_client_idx ON documents (client_id) WHERE deleted_at IS NULL;

-- ─── Satisfaction surveys ───────────────────────────────────────────────────
CREATE TABLE satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  trigger_phase project_phase NOT NULL,
  trigger_task_template_id UUID REFERENCES task_templates(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  global_score INTEGER CHECK (global_score BETWEEN 1 AND 5),
  communication_score INTEGER CHECK (communication_score BETWEEN 1 AND 5),
  reactivity_score INTEGER CHECK (reactivity_score BETWEEN 1 AND 5),
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
  deadline_score INTEGER CHECK (deadline_score BETWEEN 1 AND 5),
  comment TEXT,

  nps_score INTEGER CHECK (nps_score BETWEEN 0 AND 10),
  nps_comment TEXT,

  CHECK (
    trigger_phase = 'livraison'
    OR (nps_score IS NULL AND nps_comment IS NULL)
  )
);

CREATE UNIQUE INDEX surveys_uniq ON satisfaction_surveys (project_id, trigger_phase);

-- ─── Email logs ─────────────────────────────────────────────────────────────
CREATE TABLE email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  recipient_email TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  locale TEXT NOT NULL DEFAULT 'fr-FR',
  subject TEXT,
  payload JSONB,
  resend_id TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','opened','bounced','complained','failed')),
  status_updated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_until DATE GENERATED ALWAYS AS (((sent_at AT TIME ZONE 'UTC')::date + INTERVAL '365 days')::date) STORED
);

CREATE INDEX email_logs_project_idx ON email_logs (project_id, sent_at DESC);
CREATE INDEX email_logs_retention_idx ON email_logs (retention_until);

-- ─── Scheduled jobs (consommée par cron quotidien) ──────────────────────────
CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scheduled_jobs_run_idx ON scheduled_jobs (run_at) WHERE status = 'pending';

CREATE TRIGGER scheduled_jobs_set_updated_at BEFORE UPDATE ON scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── In-app notifications ───────────────────────────────────────────────────
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
