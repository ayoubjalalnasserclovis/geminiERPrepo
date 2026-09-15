-- ============================================================================
-- 2026-08-24 — Étend finance_audit_log_table_name_check pour couvrir la table
-- 'projects' (édit inline des dates chantier + changements sous-phase).
--
-- Contexte : le brief hebdo Projets (bloc 7 "Dates clés modifiées") liste les
-- modifs des 3 dates chantier (travaux_start_date, travaux_end_date,
-- livraison_date). Les server actions updateChantierDateAction et
-- updateChantierSousPhaseAction loggent désormais dans finance_audit_log avec
-- table_name = 'projects' — la contrainte CHECK doit autoriser cette valeur.
--
-- On liste toutes les valeurs déjà autorisées + ajoute 'projects'. IDEMPOTENT.
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
    'documents'::text,
    'achats_estimations'::text,
    'projects'::text
  ]));
