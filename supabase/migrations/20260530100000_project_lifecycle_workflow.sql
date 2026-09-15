-- ============================================================================
-- PROJECT LIFECYCLE WORKFLOW — pause / perdu  (v2)
-- ============================================================================
-- Met en place le système de validation des transitions actif ↔ pause ↔ perdu
-- avec workflow asymétrique chef_projet → CEO, audit complet, side effects
-- automatiques sur payments et notifications.
--
-- Référence : docs/lifecycle-state/phase2-design.md (validé par Othmane 2026-05-29)
-- Revue statique : docs/lifecycle-state/phase3-test-results.md
--
-- v2 (2026-05-29 22h45) — 4 fixes post-revue statique :
--   - Bug 1 : resurrect_from_lost nettoie maintenant lost_revenue_amount + lessons_learned
--   - Bug 2 : DROP CONSTRAINT payments_status_check robuste (pg_constraint lookup)
--   - A2   : request_lifecycle_pause refuse si demande pending déjà existante
--   - A3   : mark_project_lost refuse les montants négatifs
--
-- IDEMPOTENT — IF NOT EXISTS partout, aucun DROP destructif.
-- ============================================================================

-- ─── 1. Enums raison ────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE pause_reason_code AS ENUM (
    'financement_attendu',
    'sourcing_bloque',
    'client_indisponible',
    'litige_partenaire',
    'autre'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lost_reason_code AS ENUM (
    'client_retire',
    'concurrent',
    'desaccord_contractuel',
    'qualite_reprochee',
    'delai_excessif',
    'defaut_financement',
    'autre'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Colonnes sur projects ───────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS phase_at_lifecycle_change project_phase,
  ADD COLUMN IF NOT EXISTS last_lifecycle_transition_id UUID,
  ADD COLUMN IF NOT EXISTS lost_revenue_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS lessons_learned TEXT,
  ADD COLUMN IF NOT EXISTS expected_resume_at DATE,
  ADD COLUMN IF NOT EXISTS pause_reason_code_v pause_reason_code,
  ADD COLUMN IF NOT EXISTS lost_reason_code_v  lost_reason_code;

COMMENT ON COLUMN projects.phase_at_lifecycle_change IS
  'Snapshot de current_phase au moment du passage en pause/perdu. NULL pour actif. Reset à NULL au resume.';
COMMENT ON COLUMN projects.last_lifecycle_transition_id IS
  'FK vers la dernière transition validée. Raccourci d''affichage pour éviter un JOIN sur l''audit.';
COMMENT ON COLUMN projects.lost_revenue_amount IS
  'Snapshot du manque à gagner honoraires au passage en perdu. Immuable pour analytics.';
COMMENT ON COLUMN projects.lessons_learned IS
  'Texte libre min 50 chars, obligatoire pour perdu. Source des analytics "leçons d''équipe".';
COMMENT ON COLUMN projects.expected_resume_at IS
  'Date prévisionnelle de reprise pour pause. INDICATIF — jamais déclencheur automatique.';

-- ─── 3. Extension payments.status (on_hold + cancelled) ─────────────────────

-- DROP robuste : on cherche le vrai nom de la CHECK inline (PG ne garantit pas
-- le nom auto-généré). On boucle sur pg_constraint pour trouver toute CHECK
-- sur payments qui mentionne 'pending' (signature du CHECK existant).
DO $$
DECLARE
  c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'payments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%pending%paid%'
  LOOP
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','partial','paid','overdue','on_hold','cancelled'));

-- Patch du trigger sync_payment_status pour qu'il respecte on_hold et cancelled
-- (sans ça, le trigger écraserait toute mise en pause/annulation au prochain UPDATE)
CREATE OR REPLACE FUNCTION sync_payment_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Bypass total si le paiement est gelé ou annulé : la décision est métier,
  -- on ne recalcule pas tant qu'on n'a pas re-libéré explicitement le paiement
  IF NEW.status IN ('on_hold','cancelled') THEN
    RETURN NEW;
  END IF;

  IF NEW.amount_paid >= NEW.amount_expected THEN
    NEW.status := 'paid';
    IF NEW.paid_at IS NULL THEN NEW.paid_at := CURRENT_DATE; END IF;
  ELSIF NEW.amount_paid > 0 THEN
    NEW.status := 'partial';
  ELSIF NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'overdue';
  ELSE
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Table project_lifecycle_transition ──────────────────────────────────

CREATE TABLE IF NOT EXISTS project_lifecycle_transition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  workflow_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (workflow_status IN ('pending','approved','rejected','cancelled')),

  from_status TEXT NOT NULL CHECK (from_status IN ('actif','pause','perdu','termine')),
  to_status   TEXT NOT NULL CHECK (to_status   IN ('actif','pause','perdu')),
  from_phase_snapshot project_phase,

  requested_by UUID NOT NULL REFERENCES profiles(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_by UUID REFERENCES profiles(id),
  validated_at TIMESTAMPTZ,
  validation_decision_memo TEXT,

  pause_reason_code_v pause_reason_code,
  lost_reason_code_v  lost_reason_code,
  memo TEXT,

  lost_revenue_snapshot NUMERIC(14,2),
  lessons_learned TEXT,
  expected_resume_at DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plt_project_time_idx
  ON project_lifecycle_transition (project_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS plt_pending_idx
  ON project_lifecycle_transition (project_id, requested_at DESC)
  WHERE workflow_status = 'pending';

COMMENT ON TABLE project_lifecycle_transition IS
  'Journal des transitions de status pause/perdu/actif. Sert d''audit, de file de validation CEO et de source pour la timeline UI.';

-- FK retardée sur projects.last_lifecycle_transition_id (la table n'existait pas avant)
DO $$ BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_last_lifecycle_transition_fkey
    FOREIGN KEY (last_lifecycle_transition_id) REFERENCES project_lifecycle_transition(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS sur la table audit
ALTER TABLE project_lifecycle_transition ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plt_staff_read ON project_lifecycle_transition;
CREATE POLICY plt_staff_read ON project_lifecycle_transition FOR SELECT
  USING (is_staff());

DROP POLICY IF EXISTS plt_ceo_write ON project_lifecycle_transition;
CREATE POLICY plt_ceo_write ON project_lifecycle_transition FOR ALL
  USING (is_staff(ARRAY['ceo']))
  WITH CHECK (is_staff(ARRAY['ceo']));

-- ─── 5. Trigger BEFORE UPDATE : protège projects.status hors RPC/CEO ────────

CREATE OR REPLACE FUNCTION trg_protect_projects_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_caller_role TEXT;
  v_bypass TEXT;
BEGIN
  -- Pas de changement de status : laisser passer
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Bypass explicite par une RPC SECURITY DEFINER
  v_bypass := current_setting('app.bypass_status_check', true);
  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  -- Sinon : seul un CEO authentifié peut changer status directement
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role = 'ceo' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'projects.status ne peut être modifié que via une RPC lifecycle ou par un CEO authentifié (role actuel: %)', COALESCE(v_caller_role, 'inconnu');
END;
$$;

DROP TRIGGER IF EXISTS projects_protect_status ON projects;
CREATE TRIGGER projects_protect_status
  BEFORE UPDATE OF status ON projects
  FOR EACH ROW
  EXECUTE FUNCTION trg_protect_projects_status();

-- ─── 6. Extension can_notify_for_project : exiger status='actif' ────────────

CREATE OR REPLACE FUNCTION can_notify_for_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.is_preparation = false
    AND p.legacy_imported = false
    AND p.activated_at IS NOT NULL
    AND p.client_id IS NOT NULL
    AND p.deleted_at IS NULL
    AND p.status = 'actif'
  FROM projects p
  WHERE p.id = p_project_id;
$$;

-- ─── 7. RPC : request_lifecycle_pause ──────────────────────────────────────
-- chef_projet / commercial / CEO peuvent demander.
-- Si CEO demande : auto-validation (transition immédiate).
-- Sinon : ligne 'pending' créée, en attente de validate_lifecycle_transition.

CREATE OR REPLACE FUNCTION request_lifecycle_pause(
  p_project_id UUID,
  p_reason_code pause_reason_code,
  p_expected_resume_at DATE,
  p_memo TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_project projects;
  v_transition_id UUID;
  v_auto_validated BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role NOT IN ('ceo','chef_projet','commercial') THEN
    RAISE EXCEPTION 'Rôle non autorisé pour demander une pause: %', v_role;
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  IF v_project.status <> 'actif' THEN
    RAISE EXCEPTION 'Seuls les projets actifs peuvent être mis en pause (status actuel: %)', v_project.status;
  END IF;

  IF p_memo IS NULL OR length(trim(p_memo)) < 5 THEN
    RAISE EXCEPTION 'Mémo requis (min 5 caractères)';
  END IF;

  -- Empêcher une seconde demande de pause si une est déjà en attente
  -- (sinon la file de validation CEO devient bordélique)
  IF EXISTS (
    SELECT 1 FROM project_lifecycle_transition
    WHERE project_id = p_project_id
      AND workflow_status = 'pending'
      AND to_status = 'pause'
  ) THEN
    RAISE EXCEPTION 'Une demande de pause est déjà en attente de validation pour ce projet';
  END IF;

  v_auto_validated := (v_role = 'ceo');

  INSERT INTO project_lifecycle_transition (
    project_id, workflow_status,
    from_status, to_status, from_phase_snapshot,
    requested_by, validated_by, validated_at,
    pause_reason_code_v, memo, expected_resume_at
  ) VALUES (
    p_project_id,
    CASE WHEN v_auto_validated THEN 'approved' ELSE 'pending' END,
    'actif', 'pause', v_project.current_phase,
    v_user_id,
    CASE WHEN v_auto_validated THEN v_user_id ELSE NULL END,
    CASE WHEN v_auto_validated THEN now()    ELSE NULL END,
    p_reason_code, p_memo, p_expected_resume_at
  ) RETURNING id INTO v_transition_id;

  IF v_auto_validated THEN
    PERFORM set_config('app.bypass_status_check', 'on', true);

    UPDATE projects
    SET status = 'pause',
        paused_at = now(),
        resumed_at = NULL,
        phase_at_lifecycle_change = v_project.current_phase,
        pause_reason_code_v = p_reason_code,
        expected_resume_at = p_expected_resume_at,
        last_lifecycle_transition_id = v_transition_id,
        updated_at = now()
    WHERE id = p_project_id;

    -- Side effect : geler les paiements pending
    UPDATE payments SET status = 'on_hold', updated_at = now()
    WHERE project_id = p_project_id AND status IN ('pending','overdue');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'transition_id', v_transition_id,
    'auto_validated', v_auto_validated
  );
END;
$$;

-- ─── 8. RPC : validate_lifecycle_transition (CEO uniquement) ───────────────

CREATE OR REPLACE FUNCTION validate_lifecycle_transition(
  p_transition_id UUID,
  p_decision TEXT,         -- 'approved' | 'rejected'
  p_decision_memo TEXT     -- optionnel
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_t project_lifecycle_transition;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role <> 'ceo' THEN
    RAISE EXCEPTION 'Seul un CEO peut valider une transition lifecycle';
  END IF;

  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Décision invalide: %', p_decision;
  END IF;

  SELECT * INTO v_t FROM project_lifecycle_transition
  WHERE id = p_transition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transition introuvable';
  END IF;

  IF v_t.workflow_status <> 'pending' THEN
    RAISE EXCEPTION 'Transition déjà traitée (workflow_status=%)', v_t.workflow_status;
  END IF;

  UPDATE project_lifecycle_transition
  SET workflow_status = p_decision,
      validated_by = v_user_id,
      validated_at = now(),
      validation_decision_memo = p_decision_memo
  WHERE id = p_transition_id;

  IF p_decision = 'approved' AND v_t.to_status = 'pause' THEN
    PERFORM set_config('app.bypass_status_check', 'on', true);
    UPDATE projects
    SET status = 'pause',
        paused_at = now(),
        resumed_at = NULL,
        phase_at_lifecycle_change = v_t.from_phase_snapshot,
        pause_reason_code_v = v_t.pause_reason_code_v,
        expected_resume_at = v_t.expected_resume_at,
        last_lifecycle_transition_id = p_transition_id,
        updated_at = now()
    WHERE id = v_t.project_id;

    UPDATE payments SET status = 'on_hold', updated_at = now()
    WHERE project_id = v_t.project_id AND status IN ('pending','overdue');
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

-- ─── 9. RPC : mark_project_lost (CEO seul, pas de workflow) ────────────────

CREATE OR REPLACE FUNCTION mark_project_lost(
  p_project_id UUID,
  p_reason_code lost_reason_code,
  p_lost_revenue_amount NUMERIC,
  p_lessons_learned TEXT,
  p_memo TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_project projects;
  v_transition_id UUID;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role <> 'ceo' THEN
    RAISE EXCEPTION 'Seul un CEO peut marquer un projet comme perdu';
  END IF;

  IF p_lessons_learned IS NULL OR length(trim(p_lessons_learned)) < 50 THEN
    RAISE EXCEPTION 'Leçons apprises requises (min 50 caractères)';
  END IF;

  IF p_lost_revenue_amount IS NULL OR p_lost_revenue_amount < 0 THEN
    RAISE EXCEPTION 'Montant honoraires perdus requis et >= 0 (reçu: %)', p_lost_revenue_amount;
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  IF v_project.status NOT IN ('actif','pause') THEN
    RAISE EXCEPTION 'Seuls les projets actif ou pause peuvent passer en perdu (actuel: %)', v_project.status;
  END IF;

  INSERT INTO project_lifecycle_transition (
    project_id, workflow_status,
    from_status, to_status, from_phase_snapshot,
    requested_by, validated_by, validated_at,
    lost_reason_code_v, memo, lost_revenue_snapshot, lessons_learned
  ) VALUES (
    p_project_id, 'approved',
    v_project.status, 'perdu', v_project.current_phase,
    v_user_id, v_user_id, now(),
    p_reason_code, p_memo, p_lost_revenue_amount, p_lessons_learned
  ) RETURNING id INTO v_transition_id;

  PERFORM set_config('app.bypass_status_check', 'on', true);
  UPDATE projects
  SET status = 'perdu',
      lost_at = now(),
      lost_reason = p_memo,
      lost_reason_code_v = p_reason_code,
      lost_revenue_amount = p_lost_revenue_amount,
      lessons_learned = p_lessons_learned,
      phase_at_lifecycle_change = v_project.current_phase,
      last_lifecycle_transition_id = v_transition_id,
      updated_at = now()
  WHERE id = p_project_id;

  -- Side effect : annuler les paiements en attente
  UPDATE payments SET status = 'cancelled', updated_at = now()
  WHERE project_id = p_project_id AND status IN ('pending','overdue','on_hold','partial');

  RETURN jsonb_build_object('ok', true, 'transition_id', v_transition_id);
END;
$$;

-- ─── 10. RPC : resume_lifecycle (pause → actif, CEO 1-clic) ────────────────

CREATE OR REPLACE FUNCTION resume_lifecycle(p_project_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_project projects;
  v_transition_id UUID;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role <> 'ceo' THEN
    RAISE EXCEPTION 'Seul un CEO peut reprendre un projet en pause';
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  IF v_project.status <> 'pause' THEN
    RAISE EXCEPTION 'Seuls les projets en pause peuvent être repris (actuel: %)', v_project.status;
  END IF;

  INSERT INTO project_lifecycle_transition (
    project_id, workflow_status,
    from_status, to_status, from_phase_snapshot,
    requested_by, validated_by, validated_at, memo
  ) VALUES (
    p_project_id, 'approved',
    'pause', 'actif', v_project.current_phase,
    v_user_id, v_user_id, now(), 'Reprise depuis pause'
  ) RETURNING id INTO v_transition_id;

  PERFORM set_config('app.bypass_status_check', 'on', true);
  UPDATE projects
  SET status = 'actif',
      resumed_at = now(),
      phase_at_lifecycle_change = NULL,
      pause_reason_code_v = NULL,
      expected_resume_at = NULL,
      last_lifecycle_transition_id = v_transition_id,
      updated_at = now()
  WHERE id = p_project_id;

  -- Side effect : remettre les paiements on_hold en pending
  UPDATE payments SET status = 'pending', updated_at = now()
  WHERE project_id = p_project_id AND status = 'on_hold';

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── 11. RPC : resurrect_from_lost (perdu → actif, friction) ───────────────

CREATE OR REPLACE FUNCTION resurrect_from_lost(
  p_project_id UUID,
  p_justification TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_project projects;
  v_transition_id UUID;
  v_property_taken_by UUID;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role <> 'ceo' THEN
    RAISE EXCEPTION 'Seul un CEO peut ressusciter un projet perdu';
  END IF;

  IF p_justification IS NULL OR length(trim(p_justification)) < 50 THEN
    RAISE EXCEPTION 'Justification requise (min 50 caractères)';
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  IF v_project.status <> 'perdu' THEN
    RAISE EXCEPTION 'Seuls les projets perdus peuvent être ressuscités (actuel: %)', v_project.status;
  END IF;

  -- Vérif : le bien doit encore être libre (sinon un autre projet l'a repris)
  IF v_project.property_id IS NOT NULL THEN
    SELECT id INTO v_property_taken_by
    FROM projects
    WHERE property_id = v_project.property_id
      AND id <> p_project_id
      AND deleted_at IS NULL
      AND status IN ('actif','termine');
    IF v_property_taken_by IS NOT NULL THEN
      RAISE EXCEPTION 'Le bien associé est désormais lié à un autre projet (%). Résurrection impossible.', v_property_taken_by;
    END IF;
  END IF;

  INSERT INTO project_lifecycle_transition (
    project_id, workflow_status,
    from_status, to_status, from_phase_snapshot,
    requested_by, validated_by, validated_at, memo
  ) VALUES (
    p_project_id, 'approved',
    'perdu', 'actif', v_project.current_phase,
    v_user_id, v_user_id, now(), p_justification
  ) RETURNING id INTO v_transition_id;

  PERFORM set_config('app.bypass_status_check', 'on', true);
  UPDATE projects
  SET status = 'actif',
      lost_at = NULL,
      lost_reason = NULL,
      lost_reason_code_v = NULL,
      lost_revenue_amount = NULL,
      lessons_learned = NULL,
      phase_at_lifecycle_change = NULL,
      last_lifecycle_transition_id = v_transition_id,
      updated_at = now()
  WHERE id = p_project_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── 12. Permissions d'exécution ───────────────────────────────────────────

GRANT EXECUTE ON FUNCTION request_lifecycle_pause(UUID, pause_reason_code, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_lifecycle_transition(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_project_lost(UUID, lost_reason_code, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resume_lifecycle(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION resurrect_from_lost(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION can_notify_for_project(UUID) TO authenticated;

-- ─── 13. Seed legacy : Inés JABER + Ziad Hassan ────────────────────────────
-- Crée 2 lignes audit rétroactives pour les 2 leads pause conservés.
-- Auto-validées, reason_code='autre', memo explicite.

DO $$
DECLARE
  v_ceo_id UUID;
  v_p1 projects;
  v_p2 projects;
  v_t1 UUID;
  v_t2 UUID;
BEGIN
  SELECT id INTO v_ceo_id FROM profiles WHERE role = 'ceo' LIMIT 1;
  IF v_ceo_id IS NULL THEN
    RAISE NOTICE 'Aucun CEO trouvé, skip du seed legacy.';
    RETURN;
  END IF;

  SELECT p.* INTO v_p1 FROM projects p
  JOIN clients c ON c.id = p.client_id
  WHERE lower(c.email) = 'ines.jaber@outlook.com' AND p.deleted_at IS NULL
  LIMIT 1;

  SELECT p.* INTO v_p2 FROM projects p
  JOIN clients c ON c.id = p.client_id
  WHERE lower(c.email) = 'p.ziadhassan@gmail.com' AND p.deleted_at IS NULL
  LIMIT 1;

  IF v_p1.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_lifecycle_transition WHERE project_id = v_p1.id
  ) THEN
    INSERT INTO project_lifecycle_transition (
      project_id, workflow_status, from_status, to_status, from_phase_snapshot,
      requested_by, validated_by, validated_at,
      pause_reason_code_v, memo
    ) VALUES (
      v_p1.id, 'approved', 'actif', 'pause', v_p1.current_phase,
      v_ceo_id, v_ceo_id, now(),
      'autre', 'Seed legacy — import Notion, raison réelle inconnue à l''époque'
    ) RETURNING id INTO v_t1;

    UPDATE projects
    SET phase_at_lifecycle_change = v_p1.current_phase,
        pause_reason_code_v = 'autre',
        last_lifecycle_transition_id = v_t1,
        paused_at = COALESCE(paused_at, v_p1.created_at)
    WHERE id = v_p1.id;
  END IF;

  IF v_p2.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_lifecycle_transition WHERE project_id = v_p2.id
  ) THEN
    INSERT INTO project_lifecycle_transition (
      project_id, workflow_status, from_status, to_status, from_phase_snapshot,
      requested_by, validated_by, validated_at,
      pause_reason_code_v, memo
    ) VALUES (
      v_p2.id, 'approved', 'actif', 'pause', v_p2.current_phase,
      v_ceo_id, v_ceo_id, now(),
      'autre', 'Seed legacy — import Notion, raison réelle inconnue à l''époque'
    ) RETURNING id INTO v_t2;

    UPDATE projects
    SET phase_at_lifecycle_change = v_p2.current_phase,
        pause_reason_code_v = 'autre',
        last_lifecycle_transition_id = v_t2,
        paused_at = COALESCE(paused_at, v_p2.created_at)
    WHERE id = v_p2.id;
  END IF;
END $$;

-- ============================================================================
-- État cible après cette migration :
--   - 2 enums créés (pause_reason_code, lost_reason_code)
--   - 7 colonnes ajoutées sur projects
--   - payments.status accepte on_hold + cancelled (CHECK étendu, trigger patché)
--   - Table project_lifecycle_transition + 2 index + RLS (CEO write, staff read)
--   - Trigger projects_protect_status BEFORE UPDATE OF status
--   - 5 RPC SECURITY DEFINER exposées aux utilisateurs authentifiés
--   - can_notify_for_project exige désormais status='actif'
--   - 2 lignes audit seedées pour Inés JABER et Ziad Hassan
--
-- Phase 4 (UI + server actions) : prochaine étape.
-- ============================================================================
