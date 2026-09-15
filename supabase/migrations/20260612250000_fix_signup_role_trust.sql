-- ════════════════════════════════════════════════════════════════════════════
-- QA-BUG-015 (S1 — sécurité) — Auto-promotion CEO via signup public
--
-- Reproduction (QA 2026-06-12, prod) : POST /auth/v1/signup avec la clé anon
-- publique et `data: { role: 'ceo' }` → compte créé (HTTP 200) ET le trigger
-- handle_new_auth_user posait role='ceo' dans profiles (vérifié : 1 compte
-- inconnu devenu ceo, supprimé depuis). Combiné à is_staff(), cela ouvrait
-- toute la plateforme à n'importe quel internaute.
--
-- Cause racine : handle_new_auth_user faisait
--   COALESCE(NEW.raw_user_meta_data->>'role', 'client')
-- or raw_user_meta_data (= champ `data` du signup) est ENTIÈREMENT contrôlé
-- par l'appelant non authentifié. Le rôle ne doit JAMAIS venir de là.
--
-- Fix : le trigger force TOUJOURS role='client' à la création. L'attribution
-- d'un rôle privilégié se fait exclusivement après coup via service_role :
--   • inviteTeamMemberAction → UPSERT profiles avec le bon rôle (team/actions.ts)
--   • invitations clients → role='client' explicite
-- Aucun flux applicatif ne dépend du rôle posé par le trigger (tous re-écrivent).
--
-- Défense en profondeur complémentaire (hors migration, à faire côté config
-- Supabase Auth) : désactiver le signup public (disable_signup) — l'app est
-- 100% sur invitation. Consigné au buglog (action CEO).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'client'  -- ← QA-BUG-015 : rôle JAMAIS dérivé des metadata utilisateur.
              --   Les rôles privilégiés sont posés post-création via service_role.
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
