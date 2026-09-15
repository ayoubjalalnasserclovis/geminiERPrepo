-- ============================================================================
-- Caisse Stoniz — RLS : alignement des SELECT avec la matrice app layer
-- ============================================================================
-- Contexte : la page /caisse-stoniz + /caisse-stoniz/[walletId] autorise
--   ceo, chef_projet, developer, finance, assistante, achats, sourcing
-- côté requireRole. Mais RLS SELECT sur :
--   - stoniz_wallets              : ceo, chef_projet, finance, assistante
--   - stoniz_wallet_dotations     : ceo, chef_projet, finance, assistante
--   - stoniz_wallet_expenses      : ceo, chef_projet, finance, achats, developer
-- résultat : sourcing (Chakib FERJIJ) accède à la page mais voit vide, achats
-- ne voit pas les caisses/dotations, developer ne voit pas les caisses/dotations.
--
-- Fix : matrice SELECT unifiée
--   ceo + chef_projet + finance + assistante + achats + sourcing + developer
-- côté 3 tables. Cohérent avec expenses (déjà étendu à achats/developer via
-- migration 20260622400000_caisse_stoniz_extend.sql). On ajoute sourcing partout
-- (ligne app: /caisse-stoniz commit f4fab3e) et achats/developer sur wallets +
-- dotations pour symétrie avec expenses.
--
-- WRITE (INSERT/UPDATE/DELETE) inchangé sur wallets et dotations (CEO uniquement
-- pour dotations, ceo/chef_projet/finance/assistante pour wallets — la matrice
-- métier est plus stricte côté écriture). Expenses garde sa matrice actuelle
-- (INSERT/UPDATE ceo/chef_projet/finance/achats — pas de sourcing en écriture
-- pour l'instant, on attendra confirmation métier).
-- ============================================================================

-- ─── stoniz_wallets : SELECT étendu ───────────────────────────────────────
DROP POLICY IF EXISTS stoniz_wallets_staff_read ON public.stoniz_wallets;
CREATE POLICY stoniz_wallets_staff_read
  ON public.stoniz_wallets
  FOR SELECT
  USING (
    is_staff(ARRAY['ceo','chef_projet','finance','assistante','achats','sourcing','developer'])
  );

-- ─── stoniz_wallet_dotations : SELECT étendu ──────────────────────────────
DROP POLICY IF EXISTS stoniz_wallet_dotations_staff_read ON public.stoniz_wallet_dotations;
CREATE POLICY stoniz_wallet_dotations_staff_read
  ON public.stoniz_wallet_dotations
  FOR SELECT
  USING (
    is_staff(ARRAY['ceo','chef_projet','finance','assistante','achats','sourcing','developer'])
  );

-- ─── stoniz_wallet_expenses : SELECT étendu (ajout sourcing + assistante) ─
-- Note : la matrice existante était ceo/chef_projet/finance/achats/developer.
-- On ajoute sourcing (nouveau rôle, symétrie app) et assistante (parité avec
-- wallets/dotations et cohérence avec les autres modules cash côté propria).
DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_read ON public.stoniz_wallet_expenses;
CREATE POLICY stoniz_wallet_expenses_staff_read
  ON public.stoniz_wallet_expenses
  FOR SELECT
  USING (
    is_staff(ARRAY['ceo','chef_projet','finance','assistante','achats','sourcing','developer'])
  );

COMMENT ON POLICY stoniz_wallets_staff_read ON public.stoniz_wallets IS
  'SELECT ouvert à toute la team Caisse Stoniz (align app layer). WRITE reste plus strict.';
COMMENT ON POLICY stoniz_wallet_dotations_staff_read ON public.stoniz_wallet_dotations IS
  'SELECT ouvert à toute la team Caisse Stoniz. WRITE = CEO uniquement.';
COMMENT ON POLICY stoniz_wallet_expenses_staff_read ON public.stoniz_wallet_expenses IS
  'SELECT ouvert à toute la team Caisse Stoniz (ceo/chef_projet/finance/assistante/achats/sourcing/developer). WRITE conserve la matrice restrictive de 20260622400000.';
