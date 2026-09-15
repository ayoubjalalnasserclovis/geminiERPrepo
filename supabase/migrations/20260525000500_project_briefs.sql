-- ============================================================================
-- Cahier des charges projet (brief)
-- Rempli en onboarding par le chef de projet, validé par le client.
-- La phase Sourcing est bloquée tant que le brief n'est pas validé.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,

  -- Type & localisation
  property_types TEXT[] NOT NULL DEFAULT '{}',
  quartiers TEXT[] NOT NULL DEFAULT '{}',

  -- Budget (EUR)
  budget_total_max NUMERIC(14,2),
  budget_acquisition_max NUMERIC(14,2),
  budget_travaux_max NUMERIC(14,2),
  budget_deco_max NUMERIC(14,2),
  available_savings NUMERIC(14,2),
  financing_type TEXT CHECK (financing_type IN (
    'fonds_propres','banque_classique','banque_islamique','mixte'
  )),

  -- Caracteristiques bien
  superficie_min NUMERIC(8,2),
  superficie_max NUMERIC(8,2),
  nb_suites_min INTEGER,
  floor_preference TEXT,
  needs_terrace BOOLEAN,
  needs_elevator BOOLEAN,
  needs_parking BOOLEAN,
  needs_pool BOOLEAN,
  needs_view BOOLEAN,

  -- Strategie locative
  rental_strategy TEXT CHECK (rental_strategy IN (
    'courte_duree','moyenne_duree','longue_duree','mixte','indecis'
  )),
  expected_rent_monthly NUMERIC(14,2),
  expected_gross_yield_pct NUMERIC(5,2),
  expected_net_yield_pct NUMERIC(5,2),

  -- Travaux & risques
  accept_heavy_works BOOLEAN,
  accept_division BOOLEAN,
  delivery_deadline DATE,

  -- Notes libres
  specificities TEXT,           -- demandes specifiques client
  exclusions TEXT,              -- ce que le client refuse
  chef_notes TEXT,              -- notes internes du chef de projet (NON visibles client)

  -- Workflow
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent_to_client','validated','rejected_by_client'
  )),
  filled_by UUID REFERENCES profiles(id),
  sent_at TIMESTAMPTZ,
  sent_by UUID REFERENCES profiles(id),
  validated_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_briefs_status_idx
  ON project_briefs (project_id, status);

DROP TRIGGER IF EXISTS project_briefs_set_updated_at ON project_briefs;
CREATE TRIGGER project_briefs_set_updated_at BEFORE UPDATE ON project_briefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE project_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brief_staff_all ON project_briefs;
CREATE POLICY brief_staff_all ON project_briefs FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

DROP POLICY IF EXISTS brief_client_read ON project_briefs;
CREATE POLICY brief_client_read ON project_briefs FOR SELECT
  USING (project_id IN (SELECT client_project_ids()));

-- Le client peut UPDATE uniquement quand le brief est sent_to_client,
-- et il ne peut faire passer le status qu'a validated ou rejected_by_client.
DROP POLICY IF EXISTS brief_client_respond ON project_briefs;
CREATE POLICY brief_client_respond ON project_briefs FOR UPDATE
  USING (
    project_id IN (SELECT client_project_ids())
    AND status = 'sent_to_client'
  )
  WITH CHECK (
    project_id IN (SELECT client_project_ids())
    AND status IN ('validated','rejected_by_client')
  );

-- ─── Type document : cahier_des_charges ──────────────────────────────────
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'devis_artisan','facture_artisan',
    'devis_fournisseur','facture_fournisseur','bon_commande',
    'attestation_regularite_fiscale','attestation_rib','attestation_cnss','attestation_assurance',
    'cahier_des_charges',
    'autre'
  ));

-- ─── Gate brief sur advance_project_phase : onboarding -> sourcing ───────
-- On etend la fonction existante : avant tout, si transition onboarding -> sourcing,
-- on exige un brief avec status='validated'.
CREATE OR REPLACE FUNCTION advance_project_phase(
  p_project_id UUID,
  p_new_phase project_phase
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
  v_survey_phase project_phase;
  v_has_validated_brief BOOLEAN;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  IF NOT (
    (v_project.current_phase = 'onboarding'       AND p_new_phase = 'sourcing') OR
    (v_project.current_phase = 'sourcing'         AND p_new_phase = 'design')   OR
    (v_project.current_phase = 'design'           AND p_new_phase = 'travaux')  OR
    (v_project.current_phase = 'travaux'          AND p_new_phase = 'livraison') OR
    (v_project.current_phase = 'livraison'        AND p_new_phase = 'mise_en_location') OR
    (v_project.current_phase = 'mise_en_location' AND p_new_phase = 'termine')
  ) THEN
    RAISE EXCEPTION 'Transition non autorisée: % → %', v_project.current_phase, p_new_phase;
  END IF;

  -- ─── Gate : cahier des charges validé pour passer en sourcing ─────────
  IF v_project.current_phase = 'onboarding' AND p_new_phase = 'sourcing' THEN
    SELECT EXISTS (
      SELECT 1 FROM project_briefs
      WHERE project_id = p_project_id AND status = 'validated'
    ) INTO v_has_validated_brief;
    IF NOT v_has_validated_brief THEN
      RAISE EXCEPTION 'Le cahier des charges doit être validé par le client avant de passer en Sourcing. Rendez-vous sur la fiche projet pour le compléter et l''envoyer au client.';
    END IF;
  END IF;

  -- ─── Gates "dates antérieures requises" pour la nouvelle phase ──────────
  IF p_new_phase IN ('design','travaux','livraison','mise_en_location','termine') THEN
    IF v_project.property_id IS NULL THEN
      RAISE EXCEPTION 'Aucun bien n''est validé pour ce projet. Acceptez d''abord une proposition.';
    END IF;
    IF v_project.compromis_date IS NULL THEN
      RAISE EXCEPTION 'Date de signature du compromis manquante (requise pour Design et au-delà).';
    END IF;
  END IF;

  IF p_new_phase IN ('travaux','livraison','mise_en_location','termine') THEN
    IF v_project.acte_authentique_date IS NULL THEN
      RAISE EXCEPTION 'Date de signature de l''acte authentique manquante (requise pour Travaux et au-delà).';
    END IF;
  END IF;

  IF p_new_phase IN ('livraison','mise_en_location','termine') THEN
    IF v_project.travaux_start_date IS NULL THEN
      RAISE EXCEPTION 'Date de lancement de chantier manquante.';
    END IF;
    IF v_project.travaux_end_date IS NULL THEN
      RAISE EXCEPTION 'Date de fin de chantier manquante.';
    END IF;
  END IF;

  IF p_new_phase IN ('mise_en_location','termine') THEN
    IF v_project.livraison_date IS NULL THEN
      RAISE EXCEPTION 'Date de remise des clés au client manquante.';
    END IF;
  END IF;

  -- ─── Tâches bloquantes ──────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';

  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Tâches bloquantes ouvertes (%) sur la phase %', v_blocking_count, v_project.current_phase;
  END IF;

  UPDATE project_phases_history
    SET completed_at = now(), completed_by = v_user_id
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND completed_at IS NULL;

  UPDATE projects
    SET current_phase = p_new_phase, updated_at = now()
    WHERE id = p_project_id;

  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, p_new_phase, now());

  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT
      p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  IF p_new_phase = 'sourcing' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_compromis', 3800, 'sourcing', CURRENT_DATE + 30);
  ELSIF p_new_phase = 'design' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_3d', 3800, 'design', CURRENT_DATE + 14);
  ELSIF p_new_phase = 'travaux' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_chantier', 4200, 'travaux', CURRENT_DATE);
  ELSIF p_new_phase = 'livraison' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_livraison', 4200, 'livraison', CURRENT_DATE);
  END IF;

  v_survey_phase := NULL;
  IF p_new_phase = 'design' THEN
    v_survey_phase := 'sourcing';
  ELSIF p_new_phase = 'travaux' THEN
    v_survey_phase := 'design';
  ELSIF p_new_phase = 'mise_en_location' THEN
    v_survey_phase := 'livraison';
  END IF;

  IF v_survey_phase IS NOT NULL AND v_project.client_id IS NOT NULL THEN
    INSERT INTO satisfaction_surveys (project_id, client_id, trigger_phase, sent_at)
    VALUES (p_project_id, v_project.client_id, v_survey_phase, now())
    ON CONFLICT (project_id, trigger_phase) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_phase', p_new_phase);
END;
$$;

COMMENT ON TABLE project_briefs IS
  'Cahier des charges projet. Workflow : draft -> sent_to_client -> validated (ou rejected_by_client). Bloque le passage onboarding -> sourcing tant que non validé.';
