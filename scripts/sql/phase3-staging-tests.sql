-- ============================================================================
-- PHASE 3 — TESTS DE LA MIGRATION LIFECYCLE WORKFLOW (à exécuter sur STAGING)
-- ============================================================================
-- 9 sections numérotées. Exécute-les UNE PAR UNE (sélectionne le bloc puis Run)
-- et envoie-moi les résultats au fur et à mesure.
--
-- ⚠ JAMAIS sur prod. Tests destructifs (création/suppression de données).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PRÉREQUIS — À FAIRE EN PREMIER (UI Supabase, pas SQL)
-- ────────────────────────────────────────────────────────────────────────────
-- 1. Sur le projet staging Supabase, Authentication > Users > Add user :
--    - Email : ceo-test@stoniz.local         (mot de passe au choix)
--    - Email : chef-test@stoniz.local
-- 2. Récupérer leurs UUID (visibles dans la colonne UID de la liste users)
-- 3. Remplacer les 2 valeurs ci-dessous avant de lancer la section 0 :

-- ============================================================================
-- 0. CONFIG : à remplir AVANT de lancer
-- ============================================================================

DO $$
BEGIN
  -- ⚠ REMPLACER ces 2 UUIDs par les vraies valeurs du staging
  PERFORM set_config('app.test_ceo_id',  '00000000-0000-0000-0000-000000000001', false);
  PERFORM set_config('app.test_chef_id', '00000000-0000-0000-0000-000000000002', false);

  RAISE NOTICE 'Config posée. CEO=%, CHEF=%',
    current_setting('app.test_ceo_id'),
    current_setting('app.test_chef_id');
END $$;

-- ============================================================================
-- 1. VÉRIFICATION SCHÉMA (lecture seule)
-- ============================================================================

-- 1.1. Migration appliquée ?
SELECT version, statements::text
FROM supabase_migrations.schema_migrations
WHERE version = '20260530100000';
-- ATTENDU : 1 ligne

-- 1.2. Enums créés ?
SELECT typname FROM pg_type
WHERE typname IN ('pause_reason_code', 'lost_reason_code')
ORDER BY typname;
-- ATTENDU : 2 lignes

-- 1.3. Colonnes ajoutées sur projects ?
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'projects'
  AND column_name IN (
    'phase_at_lifecycle_change', 'last_lifecycle_transition_id',
    'lost_revenue_amount', 'lessons_learned', 'expected_resume_at',
    'pause_reason_code_v', 'lost_reason_code_v'
  )
ORDER BY column_name;
-- ATTENDU : 7 lignes

-- 1.4. Table audit + index ?
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'project_lifecycle_transition') AS table_exists,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE tablename = 'project_lifecycle_transition') AS index_count;
-- ATTENDU : table_exists=1, index_count >= 3 (PK + 2 index)

-- 1.5. Les 6 RPC ?
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE proname IN (
  'request_lifecycle_pause', 'validate_lifecycle_transition',
  'mark_project_lost', 'resume_lifecycle', 'resurrect_from_lost',
  'can_notify_for_project'
)
ORDER BY proname;
-- ATTENDU : 6 lignes

-- 1.6. Trigger projects_protect_status ?
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'projects' AND trigger_name = 'projects_protect_status';
-- ATTENDU : 1 ligne (BEFORE, UPDATE)

-- 1.7. payments.status accepte on_hold ?
SELECT pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'payments'::regclass AND contype = 'c'
ORDER BY conname;
-- ATTENDU : un CHECK qui contient 'on_hold' et 'cancelled'

-- 1.8. Seed Inés / Ziad (probablement 0 sur staging vide, vérifie quand même)
SELECT COUNT(*) AS nb_seed_lines
FROM project_lifecycle_transition plt
JOIN projects p ON p.id = plt.project_id
JOIN clients c ON c.id = p.client_id
WHERE lower(c.email) IN ('ines.jaber@outlook.com', 'p.ziadhassan@gmail.com');
-- ATTENDU : 0 sur staging vide, 2 si tu as importé un dump prod

-- ============================================================================
-- 2. SETUP — Profils + client + projet + paiements de test
-- ============================================================================

DO $$
DECLARE
  v_ceo_id  UUID := current_setting('app.test_ceo_id')::uuid;
  v_chef_id UUID := current_setting('app.test_chef_id')::uuid;
  v_client_id UUID;
  v_project_id UUID;
BEGIN
  -- Mise à jour des rôles (Supabase Auth crée le profil par défaut en 'client')
  UPDATE profiles SET role = 'ceo',         full_name = 'CEO Test'  WHERE id = v_ceo_id;
  UPDATE profiles SET role = 'chef_projet', full_name = 'Chef Test' WHERE id = v_chef_id;

  -- Client de test
  INSERT INTO clients (full_name, email, phone)
  VALUES ('Test Lifecycle Client', 'test-lifecycle@stoniz.local', '+33 0 00 00 00 00')
  RETURNING id INTO v_client_id;

  PERFORM set_config('app.test_client_id', v_client_id::text, false);

  -- Projet de test (status par défaut = 'actif', current_phase = 'onboarding')
  INSERT INTO projects (client_id, assigned_chef_projet, current_phase, status, stoniz_fees_acquisition, stoniz_fees_travaux)
  VALUES (v_client_id, v_chef_id, 'sourcing', 'actif', 5000, 5000)
  RETURNING id INTO v_project_id;

  PERFORM set_config('app.test_project_id', v_project_id::text, false);

  -- 2 paiements pending
  INSERT INTO payments (project_id, type, amount_expected, due_date)
  VALUES
    (v_project_id, 'honoraires_compromis', 3800, CURRENT_DATE + 7),
    (v_project_id, 'honoraires_livraison', 4200, CURRENT_DATE + 30);

  RAISE NOTICE 'Setup OK. project_id=%, client_id=%', v_project_id, v_client_id;
END $$;

-- ============================================================================
-- 3. SCÉNARIO S1 — Pause via chef_projet → validation CEO → reprise
-- ============================================================================

-- 3a. Chef de projet demande la pause
DO $$
DECLARE
  v_chef_id UUID := current_setting('app.test_chef_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_chef_id, 'role', 'authenticated')::text, true);

  SELECT request_lifecycle_pause(
    v_project_id,
    'financement_attendu'::pause_reason_code,
    CURRENT_DATE + 60,
    'Client attend financement BMCE, prévision reprise dans 2 mois'
  ) INTO v_result;

  RAISE NOTICE 'S1.a request_lifecycle_pause: %', v_result;
END $$;

-- Vérifier : status doit être 'actif' encore, 1 ligne pending dans audit
SELECT status, paused_at, last_lifecycle_transition_id FROM projects
WHERE id = current_setting('app.test_project_id')::uuid;
SELECT workflow_status, from_status, to_status, pause_reason_code_v, memo
FROM project_lifecycle_transition
WHERE project_id = current_setting('app.test_project_id')::uuid
ORDER BY requested_at DESC LIMIT 1;
-- ATTENDU : status='actif', paused_at=NULL ; audit pending, to_status='pause'

-- 3b. CEO valide
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_transition_id UUID;
  v_result jsonb;
BEGIN
  SELECT id INTO v_transition_id FROM project_lifecycle_transition
  WHERE project_id = v_project_id AND workflow_status = 'pending'
  ORDER BY requested_at DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);

  SELECT validate_lifecycle_transition(v_transition_id, 'approved', NULL) INTO v_result;
  RAISE NOTICE 'S1.b validate: %', v_result;
END $$;

-- Vérifier : status='pause', paused_at posé, payments=on_hold
SELECT status, paused_at, phase_at_lifecycle_change, pause_reason_code_v
FROM projects WHERE id = current_setting('app.test_project_id')::uuid;
SELECT status, COUNT(*) AS nb FROM payments
WHERE project_id = current_setting('app.test_project_id')::uuid GROUP BY status;
-- ATTENDU : status='pause', paused_at non NULL, payments 2x 'on_hold'

-- 3c. CEO reprend
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  SELECT resume_lifecycle(v_project_id) INTO v_result;
  RAISE NOTICE 'S1.c resume: %', v_result;
END $$;

-- Vérifier : status='actif', resumed_at posé, payments=pending
SELECT status, resumed_at, phase_at_lifecycle_change, expected_resume_at
FROM projects WHERE id = current_setting('app.test_project_id')::uuid;
SELECT status, COUNT(*) AS nb FROM payments
WHERE project_id = current_setting('app.test_project_id')::uuid GROUP BY status;
-- ATTENDU : status='actif', payments 2x 'pending'

-- ============================================================================
-- 4. SCÉNARIO S2 — Pause via CEO direct (auto-validation)
-- ============================================================================

DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  SELECT request_lifecycle_pause(
    v_project_id, 'sourcing_bloque'::pause_reason_code,
    CURRENT_DATE + 30, 'CEO décide directement de geler le sourcing'
  ) INTO v_result;
  RAISE NOTICE 'S2 CEO direct: % (auto_validated should be true)', v_result;
END $$;

-- Vérifier auto-validation immédiate
SELECT status, paused_at FROM projects WHERE id = current_setting('app.test_project_id')::uuid;
-- ATTENDU : status='pause', paused_at posé

-- Refaire la reprise pour préparer S3
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.test_ceo_id')::uuid, 'role', 'authenticated')::text, true);
  PERFORM resume_lifecycle(current_setting('app.test_project_id')::uuid);
END $$;

-- ============================================================================
-- 5. SCÉNARIO S3 — Validate rejected
-- ============================================================================

DO $$
DECLARE
  v_chef_id UUID := current_setting('app.test_chef_id')::uuid;
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_transition_id UUID;
BEGIN
  -- Chef demande pause
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_chef_id, 'role', 'authenticated')::text, true);
  PERFORM request_lifecycle_pause(v_project_id, 'autre'::pause_reason_code,
    CURRENT_DATE + 14, 'Test rejet');

  SELECT id INTO v_transition_id FROM project_lifecycle_transition
  WHERE project_id = v_project_id AND workflow_status = 'pending'
  ORDER BY requested_at DESC LIMIT 1;

  -- CEO rejette
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  PERFORM validate_lifecycle_transition(v_transition_id, 'rejected', 'Pas une vraie raison');

  RAISE NOTICE 'S3 rejection done';
END $$;

-- Vérifier : status='actif' (inchangé), audit ligne 'rejected'
SELECT status FROM projects WHERE id = current_setting('app.test_project_id')::uuid;
SELECT workflow_status, validation_decision_memo
FROM project_lifecycle_transition
WHERE project_id = current_setting('app.test_project_id')::uuid
ORDER BY requested_at DESC LIMIT 1;
-- ATTENDU : status='actif', workflow_status='rejected'

-- ============================================================================
-- 6. SCÉNARIO S4 — Mark lost direct par CEO
-- ============================================================================

-- 6a. Cas heureux
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  SELECT mark_project_lost(
    v_project_id, 'concurrent'::lost_reason_code, 4200,
    'Client est parti chez Marrakech Habitat. Il faut intensifier nos campagnes de remarketing et améliorer notre temps de réponse aux premiers contacts.',
    'Test perte projet'
  ) INTO v_result;
  RAISE NOTICE 'S4.a mark_lost: %', v_result;
END $$;

-- Vérifier : status='perdu', lost_at posé, lost_revenue_amount=4200, payments=cancelled
SELECT status, lost_at, lost_revenue_amount, lost_reason_code_v, length(lessons_learned) AS lessons_chars
FROM projects WHERE id = current_setting('app.test_project_id')::uuid;
SELECT status, COUNT(*) FROM payments
WHERE project_id = current_setting('app.test_project_id')::uuid GROUP BY status;
-- ATTENDU : status='perdu', lost_revenue_amount=4200.00, payments 2x 'cancelled'

-- 6b. Cas limite : lessons_learned trop court (doit FAIL)
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM mark_project_lost(v_project_id, 'autre'::lost_reason_code, 1000, 'court', 'memo');
    RAISE NOTICE 'S4.b FAIL : aurait dû lever EXCEPTION';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'S4.b OK (exception attendue) : %', SQLERRM;
  END;
END $$;

-- 6c. Cas limite : lost_revenue négatif (doit FAIL — fix A3)
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM mark_project_lost(v_project_id, 'autre'::lost_reason_code, -100,
      'Texte de 50 caractères au moins pour passer le check de longueur des leçons apprises ok ok ok',
      'memo');
    RAISE NOTICE 'S4.c FAIL : aurait dû lever EXCEPTION sur montant négatif';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'S4.c OK (exception attendue) : %', SQLERRM;
  END;
END $$;

-- ============================================================================
-- 7. SCÉNARIO S5 — Résurrection
-- ============================================================================

-- 7a. Cas heureux
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  SELECT resurrect_from_lost(v_project_id,
    'Le client est revenu vers nous après avoir eu une mauvaise expérience avec le concurrent. Forte intention dachat.'
  ) INTO v_result;
  RAISE NOTICE 'S5.a resurrect: %', v_result;
END $$;

-- Vérifier : status='actif', lost_* tous NULL (fix Bug 1)
SELECT status, lost_at, lost_reason_code_v, lost_revenue_amount, lessons_learned
FROM projects WHERE id = current_setting('app.test_project_id')::uuid;
-- ATTENDU : status='actif', toutes les colonnes lost_* à NULL

-- 7b. Cas limite : justification trop courte (doit FAIL)
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  -- Re-mark lost pour pouvoir tester la friction sur resurrect
  PERFORM mark_project_lost(v_project_id, 'autre'::lost_reason_code, 100,
    'Texte assez long pour passer la validation des 50 caractères minimum requis par le check.',
    'memo');

  BEGIN
    PERFORM resurrect_from_lost(v_project_id, 'court');
    RAISE NOTICE 'S5.b FAIL : aurait dû lever EXCEPTION';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'S5.b OK (exception attendue) : %', SQLERRM;
  END;

  -- Re-resurrect pour préparer S6
  PERFORM resurrect_from_lost(v_project_id,
    'Justification longue de plus de 50 caractères pour la résurrection après test friction'
  );
END $$;

-- ============================================================================
-- 8. SCÉNARIO S6 — Trigger de protection projects.status
-- ============================================================================

-- 8a. chef_projet tente UPDATE direct du status → doit FAIL
DO $$
DECLARE
  v_chef_id UUID := current_setting('app.test_chef_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_chef_id, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE projects SET status = 'perdu' WHERE id = v_project_id;
    RAISE NOTICE 'S6.a FAIL : chef_projet a pu modifier status (trigger bypass !)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'S6.a OK (exception attendue) : %', SQLERRM;
  END;
END $$;

-- 8b. CEO tente UPDATE direct → doit PASSER (puis on remet en actif)
DO $$
DECLARE
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ceo_id, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE projects SET status = 'actif' WHERE id = v_project_id;
    RAISE NOTICE 'S6.b OK : CEO peut UPDATE status directement';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'S6.b FAIL : CEO bloqué par le trigger ? : %', SQLERRM;
  END;
END $$;

-- ============================================================================
-- 9. SCÉNARIO S7 — can_notify_for_project filtré sur status
-- ============================================================================

-- Activer le projet (sortie de mode préparation) pour que can_notify retourne true
DO $$
DECLARE
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_client_id UUID := current_setting('app.test_client_id')::uuid;
  v_ceo_id UUID := current_setting('app.test_ceo_id')::uuid;
BEGIN
  -- Simuler activation (sans envoyer email)
  UPDATE clients SET profile_id = v_ceo_id WHERE id = v_client_id;
  UPDATE projects
  SET is_preparation = false, activated_at = now(), legacy_imported = false
  WHERE id = v_project_id;
END $$;

-- 9a. Projet actif et activé → doit retourner TRUE
SELECT can_notify_for_project(current_setting('app.test_project_id')::uuid) AS notify_actif;

-- 9b. Projet en pause → doit retourner FALSE
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.test_ceo_id')::uuid, 'role', 'authenticated')::text, true);
  PERFORM request_lifecycle_pause(current_setting('app.test_project_id')::uuid,
    'autre'::pause_reason_code, CURRENT_DATE + 30, 'Test notification');
END $$;
SELECT can_notify_for_project(current_setting('app.test_project_id')::uuid) AS notify_pause;
-- ATTENDU : notify_pause = false

-- ============================================================================
-- 10. CLEANUP — Supprimer les données de test
-- ============================================================================
-- À LANCER À LA FIN pour ne pas polluer staging.

DO $$
DECLARE
  v_project_id UUID := current_setting('app.test_project_id')::uuid;
  v_client_id  UUID := current_setting('app.test_client_id')::uuid;
BEGIN
  DELETE FROM project_lifecycle_transition WHERE project_id = v_project_id;
  DELETE FROM payments WHERE project_id = v_project_id;
  DELETE FROM tasks WHERE project_id = v_project_id;
  DELETE FROM project_phases_history WHERE project_id = v_project_id;
  DELETE FROM projects WHERE id = v_project_id;
  DELETE FROM clients WHERE id = v_client_id;
  -- profiles + auth.users : on les laisse (réutilisables pour d'autres tests)
  RAISE NOTICE 'Cleanup OK';
END $$;
