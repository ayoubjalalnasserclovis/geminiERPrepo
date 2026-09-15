-- ============================================================================
-- 10 — RLS policies sur toutes les tables
-- ============================================================================

-- Active RLS partout
ALTER TABLE profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners                ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_agents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties              ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_media          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_phases_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_proposals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE travaux_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE satisfaction_surveys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;

-- ─── profiles ───────────────────────────────────────────────────────────────
CREATE POLICY profiles_self_or_staff_read ON profiles FOR SELECT
  USING (id = auth.uid() OR is_staff());
CREATE POLICY profiles_self_update ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin_all ON profiles FOR ALL
  USING (is_staff(ARRAY['ceo']))
  WITH CHECK (is_staff(ARRAY['ceo']));

-- ─── clients ────────────────────────────────────────────────────────────────
CREATE POLICY clients_staff_read ON clients FOR SELECT
  USING (is_staff());
CREATE POLICY clients_staff_write ON clients FOR INSERT
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','commercial']));
CREATE POLICY clients_staff_update ON clients FOR UPDATE
  USING (is_staff(ARRAY['ceo','chef_projet','commercial']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','commercial']));
CREATE POLICY clients_staff_delete ON clients FOR DELETE
  USING (is_staff(ARRAY['ceo','chef_projet']));
CREATE POLICY clients_self_read ON clients FOR SELECT
  USING (profile_id = auth.uid() AND deleted_at IS NULL);

-- ─── partners + partner_agents ──────────────────────────────────────────────
CREATE POLICY partners_staff ON partners FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','sourcing']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing']));

CREATE POLICY partner_agents_staff ON partner_agents FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','sourcing']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing']));

-- ─── properties + property_media ────────────────────────────────────────────
CREATE POLICY properties_staff_all ON properties FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing']));

CREATE POLICY property_media_staff_all ON property_media FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing']));

-- Client : voit les propriétés qui lui ont été proposées
CREATE POLICY properties_client_via_proposal ON properties FOR SELECT
  USING (
    id IN (
      SELECT property_id FROM property_proposals
      WHERE project_id IN (SELECT client_project_ids())
    )
  );

CREATE POLICY property_media_client_via_proposal ON property_media FOR SELECT
  USING (
    property_id IN (
      SELECT property_id FROM property_proposals
      WHERE project_id IN (SELECT client_project_ids())
    )
  );

-- ─── projects ───────────────────────────────────────────────────────────────
CREATE POLICY projects_staff_full ON projects FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet']));
CREATE POLICY projects_staff_read ON projects FOR SELECT
  USING (is_staff());
CREATE POLICY projects_client_own ON projects FOR SELECT
  USING (id IN (SELECT client_project_ids()));

-- ─── project_phases_history ────────────────────────────────────────────────
CREATE POLICY phh_staff_read ON project_phases_history FOR SELECT
  USING (is_staff());
CREATE POLICY phh_client_read ON project_phases_history FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

-- ─── tasks ──────────────────────────────────────────────────────────────────
CREATE POLICY tasks_staff_all ON tasks FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

-- ─── task_templates ─────────────────────────────────────────────────────────
CREATE POLICY task_templates_staff_read ON task_templates FOR SELECT
  USING (is_staff());
CREATE POLICY task_templates_ceo_write ON task_templates FOR ALL
  USING (is_staff(ARRAY['ceo']))
  WITH CHECK (is_staff(ARRAY['ceo']));

-- ─── property_proposals ─────────────────────────────────────────────────────
CREATE POLICY proposals_staff_all ON property_proposals FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing']));

CREATE POLICY proposals_client_read ON property_proposals FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

CREATE POLICY proposals_client_update ON property_proposals FOR UPDATE
  USING (project_id IN (SELECT client_project_ids()))
  WITH CHECK (project_id IN (SELECT client_project_ids()));

-- ─── payments ───────────────────────────────────────────────────────────────
CREATE POLICY payments_staff_full ON payments FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance']));
CREATE POLICY payments_staff_read ON payments FOR SELECT
  USING (is_staff());
CREATE POLICY payments_client_read ON payments FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

-- ─── travaux_payments ───────────────────────────────────────────────────────
CREATE POLICY travaux_staff_full ON travaux_payments FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance']));

-- ─── documents ──────────────────────────────────────────────────────────────
CREATE POLICY documents_staff_all ON documents FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY documents_client_read ON documents FOR SELECT
  USING (
    project_id IN (SELECT client_project_ids())
    AND is_visible_to_client = true
    AND deleted_at IS NULL
  );

CREATE POLICY documents_client_upload ON documents FOR INSERT
  WITH CHECK (
    project_id IN (SELECT client_project_ids())
    AND uploaded_by_role = 'client'
    AND uploaded_by = auth.uid()
  );

-- ─── satisfaction_surveys ───────────────────────────────────────────────────
CREATE POLICY surveys_staff_read ON satisfaction_surveys FOR SELECT
  USING (is_staff());

CREATE POLICY surveys_client_own ON satisfaction_surveys FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid()));

CREATE POLICY surveys_client_complete ON satisfaction_surveys FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid()));

-- ─── email_logs ─────────────────────────────────────────────────────────────
CREATE POLICY email_logs_staff_read ON email_logs FOR SELECT
  USING (is_staff(ARRAY['ceo','chef_projet']));

-- ─── scheduled_jobs ─────────────────────────────────────────────────────────
CREATE POLICY scheduled_jobs_ceo ON scheduled_jobs FOR SELECT
  USING (is_staff(ARRAY['ceo']));

-- ─── notifications ──────────────────────────────────────────────────────────
CREATE POLICY notifications_own_all ON notifications FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── audit_log ──────────────────────────────────────────────────────────────
CREATE POLICY audit_log_ceo_read ON audit_log FOR SELECT
  USING (is_staff(ARRAY['ceo']));
