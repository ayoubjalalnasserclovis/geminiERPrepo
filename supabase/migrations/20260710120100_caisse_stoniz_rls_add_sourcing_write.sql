-- ============================================================================
-- Caisse Stoniz — RLS : ajout sourcing en INSERT/UPDATE sur wallet_expenses
-- ============================================================================
-- Suite de 20260710120000_caisse_stoniz_rls_add_sourcing.sql (SELECT).
-- L'action app `createStonizExpenseAction` inclut déjà sourcing dans
-- EXPENSE_WRITE_ROLES ; il faut aligner la RLS INSERT/UPDATE pour éviter
-- que RLS bloque un sourcing qui tente de créer/éditer sa propre dépense.
--
-- Symétrie avec updateStonizExpenseAction : non-CEO ne peut modifier que
-- ses propres lignes (created_by = auth.uid()).
-- ============================================================================

DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_write ON public.stoniz_wallet_expenses;
CREATE POLICY stoniz_wallet_expenses_staff_write
  ON public.stoniz_wallet_expenses
  FOR INSERT
  WITH CHECK (
    is_staff(ARRAY['ceo','chef_projet','finance','achats','sourcing'])
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_update ON public.stoniz_wallet_expenses;
CREATE POLICY stoniz_wallet_expenses_staff_update
  ON public.stoniz_wallet_expenses
  FOR UPDATE
  USING (
    is_staff(ARRAY['ceo'])
    OR (
      is_staff(ARRAY['chef_projet','finance','achats','sourcing'])
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    is_staff(ARRAY['ceo'])
    OR (
      is_staff(ARRAY['chef_projet','finance','achats','sourcing'])
      AND created_by = auth.uid()
    )
  );

COMMENT ON POLICY stoniz_wallet_expenses_staff_write ON public.stoniz_wallet_expenses IS
  'INSERT : ceo/chef_projet/finance/achats/sourcing (aligné EXPENSE_WRITE_ROLES app). created_by forcé = auth.uid().';
COMMENT ON POLICY stoniz_wallet_expenses_staff_update ON public.stoniz_wallet_expenses IS
  'UPDATE : CEO tout · autres rôles autorisés uniquement leurs propres lignes (owner check).';
