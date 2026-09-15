-- ============================================================================
-- Nouveau rôle "propria" — accès limité aux écrans Propria (conciergerie)
-- Pas d'accès au reste de l'ERP Stoniz.
-- ============================================================================

-- 1. Mettre à jour le check constraint sur profiles.role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'ceo', 'chef_projet', 'sourcing', 'commercial',
    'finance', 'marketing', 'assistante',
    'propria',
    'client'
  ));

COMMENT ON COLUMN profiles.role IS
  'Rôle utilisateur : ceo, chef_projet, sourcing, commercial, finance, marketing, assistante, propria, client. Les rôles "propria" ne voient que les écrans /propria. Le rôle "client" voit uniquement son portail.';
