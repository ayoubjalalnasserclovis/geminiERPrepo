-- ============================================================================
-- Mode préparation — Fondations BDD
-- ============================================================================
-- Permet au CEO de pré-charger des projets avec des données incomplètes,
-- sans déclencher de notifications ni bloquer les transitions de phase, puis
-- d'activer client par client (ou en batch pour le big bang) en faisant
-- basculer chaque projet en mode normal.
--
-- Trois drapeaux clés sur projects :
--   - is_preparation : projet en cours de préparation par le CEO (invisible
--     côté client, gates de phase désactivables par super-admin)
--   - legacy_imported : projet déjà clôturé importé pour l'historique
--     (ne déclenche JAMAIS d'enquête / relance / PV, même après activation)
--   - activated_at : moment où le client a reçu l'invitation. NULL = pas
--     encore activé. La RLS portail client filtre sur ce champ.
--
-- Drapeau is_super_admin sur profiles : pouvoir de contournement, distinct
-- du rôle métier (role='ceo' décrit la fonction, is_super_admin le pouvoir).
--
-- 3 nouvelles tables :
--   - project_phase_bypass_log : trace de chaque transition forcée par
--     super-admin (qui, quand, quelles gates sautées, pourquoi)
--   - project_activation_snapshot : photo du projet au moment de
--     l'activation client (baseline d'audit, retour potentiel)
--   - prep_audit_log : journal de toutes les modifs en mode préparation
--     (projects, documents, payments, tasks, project_briefs)
--
-- RPC advance_project_phase refactorisée pour supporter le bypass.
--
-- IDEMPOTENT. AUCUN DROP. Backfill préserve l'app en marche.
-- ============================================================================

-- ─── 1. Drapeau super-admin sur profiles ────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.is_super_admin IS
  'Pouvoir de contournement des règles (bypass gates phase, voir tous les projets). Distinct du rôle métier role.';

-- Backfill : tout profil role='ceo' devient super-admin
UPDATE profiles SET is_super_admin = true
WHERE role = 'ceo' AND is_super_admin = false;

-- ─── 2. Drapeaux mode sur projects ──────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_preparation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_imported BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepared_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.is_preparation IS
  'Projet en cours de préparation par le CEO. Invisible côté client. Permet aux super-admins de forcer les transitions de phase. Aucune notification ne part. Passe à false à l''activation.';
COMMENT ON COLUMN projects.legacy_imported IS
  'Projet historique déjà clôturé importé pour l''archive. NE DÉCLENCHE JAMAIS d''enquête / relance / signature PV, même après activation. Le client le voit en lecture seule.';
COMMENT ON COLUMN projects.activated_at IS
  'Moment où le client a reçu l''invitation à voir son projet. NULL = pas encore activé. Combiné à client_id, gouverne la visibilité côté portail client.';

-- Backfill : tous les projets existants sont considérés "activés" depuis
-- leur création (avant cette migration ils étaient déjà visibles côté client)
UPDATE projects SET activated_at = created_at WHERE activated_at IS NULL;

-- Index pour les filtres dashboard / cron
CREATE INDEX IF NOT EXISTS projects_preparation_idx
  ON projects (is_preparation) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_activated_idx
  ON projects (activated_at) WHERE deleted_at IS NULL;

-- ─── 3. Drapeaux date approximative ─────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS compromis_date_is_approximate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acte_authentique_date_is_approximate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS travaux_start_date_is_approximate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS travaux_end_date_is_approximate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS livraison_date_is_approximate BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.compromis_date_is_approximate IS
  'true si la date a été saisie en approximation (import historique). Les enquêtes et relances l''ignorent jusqu''à confirmation.';

-- ─── 4. Visibilité interne sur documents ────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN documents.is_internal IS
  'true = document interne Stoniz (notes, devis comparatifs refusés, marges). false = exposé au portail client. Défaut sécurisé : interne.';

-- Backfill : les documents existants étaient déjà exposés par le portail
-- client, on conserve leur visibilité ouverte (sinon on casse l'expérience
-- existante des clients déjà activés).
UPDATE documents SET is_internal = false WHERE is_internal = true;

-- ─── 5. Table project_phase_bypass_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_phase_bypass_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_phase project_phase,
  to_phase project_phase NOT NULL,
  bypassed_by UUID NOT NULL REFERENCES profiles(id),
  bypassed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gates_skipped TEXT[] NOT NULL DEFAULT '{}',
  reason TEXT,
  still_in_preparation BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bypass_log_project_idx
  ON project_phase_bypass_log (project_id, bypassed_at DESC);

COMMENT ON TABLE project_phase_bypass_log IS
  'Trace de chaque transition de phase forcée par un super-admin via bypass des gates. Source de vérité pour l''audit post-activation.';

-- ─── 6. Table project_activation_snapshot ───────────────────────────────────
CREATE TABLE IF NOT EXISTS project_activation_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activated_by UUID NOT NULL REFERENCES profiles(id),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  was_legacy_imported BOOLEAN NOT NULL DEFAULT false,
  snapshot JSONB NOT NULL,
  invitation_email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (invitation_email_status IN ('pending','sent','skipped','failed')),
  invitation_email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activation_snapshot_project_idx
  ON project_activation_snapshot (project_id, activated_at DESC);

COMMENT ON TABLE project_activation_snapshot IS
  'Photo complète du projet au moment de l''activation client. Sert d''audit (que voyait le client à T0) et de baseline pour les modifs post-activation.';

-- ─── 7. Table prep_audit_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prep_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_id UUID,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  actor_id UUID REFERENCES profiles(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_data JSONB,
  new_data JSONB,
  in_preparation_mode BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS prep_audit_project_time_idx
  ON prep_audit_log (project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS prep_audit_actor_idx
  ON prep_audit_log (actor_id, changed_at DESC);

COMMENT ON TABLE prep_audit_log IS
  'Journal des modifs faites en mode préparation sur projects, documents, payments, tasks, project_briefs. Permet de retrouver qui a fait quoi avant l''activation.';

-- ─── 8. Fonction et triggers d'audit générique ──────────────────────────────
-- TG_ARGV[0] = nom de la colonne qui porte project_id (ou 'id' pour projects)
-- TG_ARGV[1] = nom de la colonne pour row_id (par défaut 'id')

CREATE OR REPLACE FUNCTION trg_prep_audit_log_generic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id_col TEXT := COALESCE(TG_ARGV[0], 'project_id');
  v_project_id UUID;
  v_row_id UUID;
  v_is_prep BOOLEAN;
  v_old JSONB;
  v_new JSONB;
BEGIN
  -- Récupère project_id selon que la table EST projects ou la référence
  IF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'DELETE' THEN
      v_project_id := OLD.id;
      v_row_id := OLD.id;
    ELSE
      v_project_id := NEW.id;
      v_row_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      EXECUTE format('SELECT ($1).%I, ($1).id', v_project_id_col)
        INTO v_project_id, v_row_id USING OLD;
    ELSE
      EXECUTE format('SELECT ($1).%I, ($1).id', v_project_id_col)
        INTO v_project_id, v_row_id USING NEW;
    END IF;
  END IF;

  IF v_project_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Récupère le mode préparation du projet
  SELECT is_preparation INTO v_is_prep FROM projects WHERE id = v_project_id;
  IF v_is_prep IS NULL OR v_is_prep = false THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Logge uniquement les modifs en mode préparation
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  END IF;

  INSERT INTO prep_audit_log (
    project_id, table_name, row_id, operation,
    actor_id, old_data, new_data, in_preparation_mode
  ) VALUES (
    v_project_id, TG_TABLE_NAME, v_row_id, TG_OP,
    auth.uid(), v_old, v_new, true
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION trg_prep_audit_log_generic IS
  'Trigger fonctionnel : si la ligne touchée appartient à un projet en mode préparation, log l''opération dans prep_audit_log. Sinon no-op.';

-- Triggers sur les 5 tables clés
DROP TRIGGER IF EXISTS projects_prep_audit ON projects;
CREATE TRIGGER projects_prep_audit
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_prep_audit_log_generic('id');

DROP TRIGGER IF EXISTS documents_prep_audit ON documents;
CREATE TRIGGER documents_prep_audit
  AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION trg_prep_audit_log_generic('project_id');

DROP TRIGGER IF EXISTS payments_prep_audit ON payments;
CREATE TRIGGER payments_prep_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_prep_audit_log_generic('project_id');

DROP TRIGGER IF EXISTS tasks_prep_audit ON tasks;
CREATE TRIGGER tasks_prep_audit
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION trg_prep_audit_log_generic('project_id');

DROP TRIGGER IF EXISTS project_briefs_prep_audit ON project_briefs;
CREATE TRIGGER project_briefs_prep_audit
  AFTER INSERT OR UPDATE OR DELETE ON project_briefs
  FOR EACH ROW EXECUTE FUNCTION trg_prep_audit_log_generic('project_id');

-- ─── 9. RPC advance_project_phase refactorisée pour bypass ──────────────────
-- Comportement :
--   - is_preparation = true ET caller super-admin : bypass total, log gates
--     sautées, pas de création auto de paiements ni de tâches
--   - is_preparation = false (cas normal) : gates strictes comme avant
--   - is_preparation = true MAIS caller non-super-admin : refuse la transition
--     (seul le super-admin peut forcer en préparation)

CREATE OR REPLACE FUNCTION advance_project_phase(
  p_project_id UUID,
  p_new_phase project_phase
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects;
  v_property properties;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
  v_is_super_admin BOOLEAN;
  v_caller_role TEXT;
  v_skipped_gates TEXT[] := '{}';
  v_in_prep BOOLEAN;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  v_in_prep := COALESCE(v_project.is_preparation, false);

  SELECT is_super_admin, role INTO v_is_super_admin, v_caller_role
    FROM profiles WHERE id = v_user_id;
  v_is_super_admin := COALESCE(v_is_super_admin, false);

  -- Transition autorisée (toujours, même en bypass — on ne saute pas par
  -- magie de onboarding à termine, l'ordre des phases reste contraint)
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

  -- En mode préparation, seul super-admin peut faire avancer la phase.
  -- Sans is_super_admin, l'erreur arrive plus tard via les gates de toute
  -- façon, mais on est explicite ici.
  IF v_in_prep AND NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Phase en mode préparation : seul un super-admin peut faire avancer ce projet.';
  END IF;

  -- ───────────────────────────────────────────────────────────────────────
  -- ÉVALUATION DES GATES — collecte des manquants dans v_skipped_gates
  -- ───────────────────────────────────────────────────────────────────────

  IF p_new_phase IN ('design','travaux','livraison','mise_en_location','termine') THEN
    IF v_project.property_id IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'property_missing');
    END IF;
    IF v_project.compromis_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'compromis_date_missing');
    END IF;
  END IF;

  IF p_new_phase IN ('travaux','livraison','mise_en_location','termine') THEN
    IF v_project.acte_authentique_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'acte_authentique_date_missing');
    END IF;
  END IF;

  IF p_new_phase IN ('livraison','mise_en_location','termine') THEN
    IF v_project.travaux_start_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'travaux_start_date_missing');
    END IF;
    IF v_project.travaux_end_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'travaux_end_date_missing');
    END IF;
  END IF;

  IF p_new_phase IN ('mise_en_location','termine') THEN
    IF v_project.livraison_date IS NULL THEN
      v_skipped_gates := array_append(v_skipped_gates, 'livraison_date_missing');
    END IF;
  END IF;

  IF p_new_phase = 'travaux' THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'compromis' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_compromis');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plans_3d' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_plans_3d');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'lots_techniques' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_lots_techniques');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'shopping_list' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_shopping_list');
    END IF;
  END IF;

  IF p_new_phase = 'mise_en_location' THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'titre_foncier' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_titre_foncier');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'autorisation_travaux' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_autorisation_travaux');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_eau' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_contrat_eau');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_electricite' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_contrat_electricite');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_assurance' AND deleted_at IS NULL) THEN
      v_skipped_gates := array_append(v_skipped_gates, 'document_missing_contrat_assurance');
    END IF;

    IF v_project.property_id IS NOT NULL THEN
      SELECT * INTO v_property FROM properties WHERE id = v_project.property_id;
      IF v_property.propria_water_contract IS NULL OR length(trim(v_property.propria_water_contract)) = 0 THEN
        v_skipped_gates := array_append(v_skipped_gates, 'contract_number_missing_eau');
      END IF;
      IF v_property.propria_electricity_contract IS NULL OR length(trim(v_property.propria_electricity_contract)) = 0 THEN
        v_skipped_gates := array_append(v_skipped_gates, 'contract_number_missing_electricite');
      END IF;
    END IF;
  END IF;

  -- Tâches bloquantes
  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';
  IF v_blocking_count > 0 THEN
    v_skipped_gates := array_append(v_skipped_gates,
      format('blocking_tasks_%s_on_phase_%s', v_blocking_count, v_project.current_phase));
  END IF;

  -- ───────────────────────────────────────────────────────────────────────
  -- DÉCISION : bypass ou refus
  -- ───────────────────────────────────────────────────────────────────────

  IF array_length(v_skipped_gates, 1) > 0 THEN
    IF v_in_prep AND v_is_super_admin THEN
      -- Bypass autorisé : on log et on continue
      INSERT INTO project_phase_bypass_log (
        project_id, from_phase, to_phase, bypassed_by,
        gates_skipped, reason, still_in_preparation
      ) VALUES (
        p_project_id, v_project.current_phase, p_new_phase, v_user_id,
        v_skipped_gates, 'Mode préparation — bypass automatique', true
      );
    ELSE
      -- Refus normal : on lève la première erreur trouvée (compat ergonomique
      -- avec l'UI existante qui affiche un seul message)
      RAISE EXCEPTION 'Transition bloquée : %', v_skipped_gates[1]
        USING HINT = 'Champs/documents manquants : ' || array_to_string(v_skipped_gates, ', ');
    END IF;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────
  -- AVANCEMENT EFFECTIF
  -- ───────────────────────────────────────────────────────────────────────

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

  -- En mode préparation, on NE CRÉE PAS les tâches auto ni les paiements
  -- jalonnés (ils sont importés explicitement par le CEO).
  IF NOT v_in_prep THEN
    INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
      SELECT p_project_id, t.id, t.phase, t.title, t.description,
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
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'new_phase', p_new_phase,
    'bypassed', (array_length(v_skipped_gates, 1) > 0 AND v_in_prep),
    'gates_skipped', v_skipped_gates
  );
END;
$$;

-- ─── 10. RLS sur les nouvelles tables ───────────────────────────────────────
ALTER TABLE project_phase_bypass_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_activation_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE prep_audit_log              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bypass_log_super_admin ON project_phase_bypass_log;
CREATE POLICY bypass_log_super_admin ON project_phase_bypass_log
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ));

DROP POLICY IF EXISTS activation_snapshot_super_admin ON project_activation_snapshot;
CREATE POLICY activation_snapshot_super_admin ON project_activation_snapshot
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ));

DROP POLICY IF EXISTS prep_audit_super_admin ON prep_audit_log;
CREATE POLICY prep_audit_super_admin ON prep_audit_log
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ));

-- ─── 11. Helper fonction can_notify_for_project ────────────────────────────
-- Utilisé par les server actions, crons et templates email pour décider
-- d'envoyer ou non une notification. Source de vérité côté SQL.

CREATE OR REPLACE FUNCTION can_notify_for_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.is_preparation = false
    AND p.legacy_imported = false
    AND p.activated_at IS NOT NULL
    AND p.client_id IS NOT NULL
    AND p.deleted_at IS NULL
  FROM projects p
  WHERE p.id = p_project_id;
$$;

COMMENT ON FUNCTION can_notify_for_project IS
  'Retourne true si le projet peut recevoir des notifications (mail, relance). Tous les sites d''envoi doivent appeler cette fonction avant de notifier.';

GRANT EXECUTE ON FUNCTION can_notify_for_project(UUID) TO authenticated;

-- ============================================================================
-- État cible :
--   - 5 nouvelles colonnes sur projects (is_preparation, legacy_imported,
--     activated_at, prepared_by, prepared_at)
--   - 5 drapeaux _is_approximate sur les dates clés
--   - is_super_admin sur profiles, set true pour role='ceo'
--   - documents.is_internal (true par défaut pour nouveaux, false pour existants)
--   - 3 tables d'audit : bypass_log, activation_snapshot, prep_audit_log
--   - 5 triggers d'audit attachés (projects, documents, payments, tasks, briefs)
--   - RPC advance_project_phase refactorisée : bypass super-admin + suppression
--     auto-création tâches/paiements en mode prep
--   - Helper can_notify_for_project exposé
--   - RLS strict sur les 3 tables d'audit (super-admin only)
--
-- Aucune UI touchée. L'app continue de tourner normalement.
-- Tous les projets existants sont marqués activated_at = created_at, donc
-- aucun client ne perd l'accès à son projet.
-- ============================================================================
