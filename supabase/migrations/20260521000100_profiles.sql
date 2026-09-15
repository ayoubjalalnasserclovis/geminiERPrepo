-- ============================================================================
-- 01 — Profiles (lié à auth.users)
-- ============================================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','client'
  )),
  phone TEXT,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'fr-FR' CHECK (locale IN ('fr-FR','fr-CH','fr-BE','fr-CA')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  mfa_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_email_lower_idx ON profiles (LOWER(email));
CREATE INDEX profiles_role_active_idx ON profiles (role) WHERE is_active = true;

-- ─── Trigger updated_at ─────────────────────────────────────────────────────
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Trigger : créer un profil à la création d'un user auth ─────────────────
-- IMPORTANT : SET search_path est requis pour que la fonction trouve la table
-- profiles quand elle est exécutée depuis le contexte de auth.users (Supabase Auth).
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
    COALESCE(NEW.raw_user_meta_data->>'role', 'client')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Donne les permissions nécessaires à Supabase Auth pour invoquer la fonction
-- et insérer dans profiles via le trigger.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT INSERT, SELECT, UPDATE ON public.profiles TO supabase_auth_admin;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ─── Trigger : forcer MFA pour ceo et finance ───────────────────────────────
CREATE OR REPLACE FUNCTION enforce_mfa_for_sensitive_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IN ('ceo','finance') THEN
    NEW.mfa_required = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_mfa_enforce
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_mfa_for_sensitive_roles();

-- ─── Helpers RLS (déclarés ici car utilisés par toutes les autres tables) ───
CREATE OR REPLACE FUNCTION is_staff(allowed_roles TEXT[] DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND is_active = true;
  IF v_role IS NULL OR v_role = 'client' THEN RETURN false; END IF;
  IF allowed_roles IS NULL THEN RETURN true; END IF;
  RETURN v_role = ANY(allowed_roles);
END;
$$;

CREATE OR REPLACE FUNCTION current_role_name() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true;
$$;
