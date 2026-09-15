-- Nouveau rôle 'menage' pour les dames de ménage (CEO 2026-06-10).
-- Accès limité à /propria/menage avec UI mobile-first.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats','client','menage']));

NOTIFY pgrst, 'reload schema';
