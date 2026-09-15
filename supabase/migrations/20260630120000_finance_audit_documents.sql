-- ============================================================================
-- 2026-06-30 — Étend finance_audit_log_table_name_check pour couvrir la table
-- 'documents' (fiche projet : titre foncier, plans 3D, contrats, etc.).
--
-- Contexte : le pattern "supprimer + ré-uploader + historique" livré sur
-- vendor_documents est étendu à la table documents générique projet. Le
-- helper logFinanceAudit insère dans finance_audit_log avec table_name =
-- 'documents' → la contrainte CHECK doit autoriser cette valeur.
--
-- Bonus : on ajoute aussi les tables 'bank_accounts', 'bank_balances',
-- 'bank_companies', 'bank_category_mappings' et 'stoniz_wallet_expenses'
-- déjà présentes dans le type TS FinanceAuditTable mais qui manquaient dans
-- la contrainte (drift silencieux — corrigé en passant pour éviter des
-- inserts qui échoueraient sans message clair côté UX).
-- ============================================================================

ALTER TABLE finance_audit_log
  DROP CONSTRAINT IF EXISTS finance_audit_log_table_name_check;

ALTER TABLE finance_audit_log
  ADD CONSTRAINT finance_audit_log_table_name_check
  CHECK (table_name = ANY (ARRAY[
    'achats_encaissements'::text,
    'travaux_encaissements'::text,
    'achats_payments'::text,
    'travaux_payments'::text,
    'payments'::text,
    'achats_lots'::text,
    'travaux_lots'::text,
    'bank_transactions'::text,
    'bank_transaction_allocations'::text,
    'bank_accounts'::text,
    'bank_balances'::text,
    'bank_companies'::text,
    'bank_category_mappings'::text,
    'vendor_documents'::text,
    'services_lots'::text,
    'services_payments'::text,
    'stoniz_wallet_expenses'::text,
    'documents'::text
  ]));
