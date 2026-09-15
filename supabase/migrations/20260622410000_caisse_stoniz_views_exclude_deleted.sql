-- ════════════════════════════════════════════════════════════════════════════
-- Caisse Stoniz — exclure les dépenses soft-deletées des vues d'agrégat.
--
-- Suite à la migration 20260622400000_caisse_stoniz_extend.sql qui ajoute
-- `deleted_at` à `stoniz_wallet_expenses`, les vues `stoniz_wallet_balances`
-- et `stoniz_project_cash_pl` continuaient à compter les dépenses supprimées
-- → solde et P&L faussés après un soft-delete.
--
-- Fix : ajouter `WHERE deleted_at IS NULL` dans le FROM expenses.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW stoniz_wallet_balances AS
SELECT w.id AS wallet_id,
    w.profile_id,
    w.label,
    COALESCE(d.total_dotations, (0)::numeric) AS total_dotations,
    COALESCE(e.total_expenses, (0)::numeric) AS total_expenses,
    COALESCE(e.total_validated, (0)::numeric) AS total_validated,
    (COALESCE(e.total_expenses, (0)::numeric) - COALESCE(e.total_validated, (0)::numeric)) AS total_unvalidated,
    (COALESCE(d.total_dotations, (0)::numeric) - COALESCE(e.total_expenses, (0)::numeric)) AS solde_mad
   FROM ((stoniz_wallets w
     LEFT JOIN ( SELECT stoniz_wallet_dotations.wallet_id,
            sum(stoniz_wallet_dotations.amount_mad) AS total_dotations
           FROM stoniz_wallet_dotations
          GROUP BY stoniz_wallet_dotations.wallet_id) d ON ((d.wallet_id = w.id)))
     LEFT JOIN ( SELECT stoniz_wallet_expenses.wallet_id,
            sum(stoniz_wallet_expenses.amount_mad) AS total_expenses,
            sum(
                CASE
                    WHEN (stoniz_wallet_expenses.is_validated = true) THEN stoniz_wallet_expenses.amount_mad
                    ELSE (0)::numeric
                END) AS total_validated
           FROM stoniz_wallet_expenses
          WHERE stoniz_wallet_expenses.deleted_at IS NULL
          GROUP BY stoniz_wallet_expenses.wallet_id) e ON ((e.wallet_id = w.id)));

CREATE OR REPLACE VIEW stoniz_project_cash_pl AS
SELECT project_id,
    sum(
        CASE
            WHEN (expense_type = 'achat'::text) THEN amount_mad
            ELSE (0)::numeric
        END) AS cash_achat_mad,
    sum(
        CASE
            WHEN (expense_type = 'travaux'::text) THEN amount_mad
            ELSE (0)::numeric
        END) AS cash_travaux_mad,
    sum(
        CASE
            WHEN (expense_type = 'autre'::text) THEN amount_mad
            ELSE (0)::numeric
        END) AS cash_autre_mad,
    sum(amount_mad) AS cash_total_mad,
    sum(
        CASE
            WHEN is_validated THEN amount_mad
            ELSE (0)::numeric
        END) AS cash_total_validated_mad
   FROM stoniz_wallet_expenses
  WHERE (project_id IS NOT NULL)
    AND deleted_at IS NULL
  GROUP BY project_id;
