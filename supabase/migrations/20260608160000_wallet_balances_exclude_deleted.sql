-- Bug : la vue propria_wallet_balances sommait TOUTES les expenses, y compris
-- celles soft-deletées. Conséquence : supprimer une dépense ne diminuait pas
-- le solde affiché côté UI.
-- Fix : on exclut deleted_at IS NOT NULL du sous-select des expenses.

CREATE OR REPLACE VIEW public.propria_wallet_balances AS
SELECT
  w.id AS wallet_id,
  w.profile_id,
  w.label,
  COALESCE(d.total_dotations, 0::numeric)  AS total_dotations,
  COALESCE(e.total_expenses,  0::numeric)  AS total_expenses,
  COALESCE(e.total_reimbursed, 0::numeric) AS total_reimbursed,
  COALESCE(e.total_validated,  0::numeric) AS total_validated,
  (COALESCE(e.total_expenses, 0::numeric) - COALESCE(e.total_validated, 0::numeric)) AS total_unvalidated,
  (COALESCE(d.total_dotations, 0::numeric) - COALESCE(e.total_expenses, 0::numeric)) AS solde_mad
FROM public.propria_wallets w
LEFT JOIN (
  SELECT wallet_id, sum(amount_mad) AS total_dotations
  FROM public.propria_wallet_dotations
  GROUP BY wallet_id
) d ON d.wallet_id = w.id
LEFT JOIN (
  SELECT
    wallet_id,
    sum(amount_mad) AS total_expenses,
    sum(CASE WHEN reimbursed_at IS NOT NULL THEN amount_mad ELSE 0 END) AS total_reimbursed,
    sum(CASE WHEN is_validated = true THEN amount_mad ELSE 0 END) AS total_validated
  FROM public.propria_wallet_expenses
  WHERE deleted_at IS NULL        -- ⬅ exclusion des dépenses soft-supprimées
  GROUP BY wallet_id
) e ON e.wallet_id = w.id;

COMMENT ON VIEW public.propria_wallet_balances IS
  'Soldes des caisses Propria. Les dépenses soft-deletées (deleted_at IS NOT NULL) sont exclues du calcul depuis 2026-06-08.';
