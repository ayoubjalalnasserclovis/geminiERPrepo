-- ============================================================================
-- Caisses Propria : remplace le concept de "remboursé" par "justifié"
-- → Justifié = dépense dont la PJ a été validée par le CEO (is_validated=true)
-- → Non justifié = dépense en attente de validation (avec ou sans PJ)
-- ============================================================================

-- Drop la vue existante car on change l'ordre/le nom des colonnes
-- (CREATE OR REPLACE VIEW interdit le renommage/réordonnancement).
DROP VIEW IF EXISTS propria_wallet_balances CASCADE;

CREATE VIEW propria_wallet_balances AS
SELECT
  w.id AS wallet_id,
  w.profile_id,
  w.label,
  COALESCE(d.total_dotations, 0)::numeric    AS total_dotations,
  COALESCE(e.total_expenses, 0)::numeric     AS total_expenses,
  COALESCE(e.total_reimbursed, 0)::numeric   AS total_reimbursed,
  COALESCE(e.total_validated, 0)::numeric    AS total_validated,
  (COALESCE(e.total_expenses, 0) - COALESCE(e.total_validated, 0))::numeric AS total_unvalidated,
  (COALESCE(d.total_dotations, 0) - COALESCE(e.total_expenses, 0))::numeric AS solde_mad
FROM propria_wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_mad) AS total_dotations
  FROM propria_wallet_dotations GROUP BY wallet_id
) d ON d.wallet_id = w.id
LEFT JOIN (
  SELECT
    wallet_id,
    SUM(amount_mad) AS total_expenses,
    SUM(CASE WHEN reimbursed_at IS NOT NULL THEN amount_mad ELSE 0 END) AS total_reimbursed,
    SUM(CASE WHEN is_validated = true THEN amount_mad ELSE 0 END) AS total_validated
  FROM propria_wallet_expenses GROUP BY wallet_id
) e ON e.wallet_id = w.id;

-- Ré-applique security_invoker (perdu lors du DROP)
ALTER VIEW propria_wallet_balances SET (security_invoker = on);

COMMENT ON VIEW propria_wallet_balances IS
  'Solde par caisse. total_validated = somme des dépenses validées (PJ vérifiée par CEO). total_unvalidated = en attente de justification.';
