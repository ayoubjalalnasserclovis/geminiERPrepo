-- ════════════════════════════════════════════════════════════════════════════
-- QA-BUG-009 (S1 — sécurité) — Escalade de privilèges via profiles_self_update
--
-- Reproduction (QA 2026-06-12, rollback) : un compte rôle 'client' authentifié
-- exécute `UPDATE profiles SET role='ceo' WHERE id=auth.uid()` via l'API REST
-- → accepté. La policy profiles_self_update (USING/CHECK id=auth.uid()) ne
-- restreint PAS les colonnes : role, is_active, mfa_required, email étaient
-- modifiables par tout utilisateur sur sa propre ligne. Avec role='ceo',
-- is_staff() ouvre ensuite TOUTES les tables (projets, paiements, clients).
--
-- Cause racine : RLS contrôle les LIGNES, pas les COLONNES. Il manquait des
-- privilèges de colonnes.
--
-- Fix : UPDATE réservé aux colonnes de profil inoffensives pour le rôle
-- authenticated. Les changements de rôle/activation passent par le client
-- admin (service_role) — déjà le cas dans app/(team)/team/actions.ts.
-- Vérifié : aucun chemin applicatif n'update profiles via le client user.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT UPDATE (full_name, phone, avatar_url, locale) ON public.profiles TO authenticated;
