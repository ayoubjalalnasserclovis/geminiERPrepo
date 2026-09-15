-- ============================================================================
-- Module Trésorerie — Socle multi-sociétés & multi-comptes (CEO 2026-06-03)
-- ============================================================================
-- Objectif Chantier 1 : permettre la saisie manuelle du solde de chaque
-- compte bancaire et offrir une vue consolidée par "business unit" (Stoniz
-- clé-en-main vs Propria conciergerie).
--
-- Démarrage : 1 seule société active (STZ OJ SARL) avec 2 comptes
--   - Chaabi Bank (Banque Populaire) Laayoune  → BP Laayoune
--   - CIH
-- Les sociétés ELZ HOLVESTA (France EUR) et STZ CLUB SARL (Propria) seront
-- ajoutées plus tard (V2). La structure est prête pour les accueillir sans
-- nouvelle migration.
--
-- Le Chantier 2 (import XLSX/CSV des relevés) s'appuiera sur les tables
-- bank_transactions + bank_transaction_allocations + bank_category_mappings
-- déjà créées ici pour éviter une migration secondaire.
--
-- Permissions :
--   - CEO + finance : tout (saisie, édition, suppression)
--   - developer : lecture seule (debug, audit)
--   - Autres rôles : aucun accès (RLS bloque)
-- ============================================================================

-- ─── 1. Sociétés du groupe ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,           -- 'stz_oj', 'stz_club', 'elz_holvesta'
  name          text NOT NULL,                  -- "STZ OJ SARL"
  legal_name    text,                            -- raison sociale complète
  country_code  text NOT NULL DEFAULT 'MA',     -- ISO-2
  currency      text NOT NULL DEFAULT 'MAD',    -- ISO-4217
  business_unit text NOT NULL CHECK (business_unit IN ('stoniz', 'propria')),
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

COMMENT ON TABLE bank_companies IS
  'Sociétés du groupe Stoniz (consolidation trésorerie). business_unit = stoniz (clé-en-main) ou propria (conciergerie).';

CREATE INDEX idx_bank_companies_business_unit ON bank_companies(business_unit) WHERE deleted_at IS NULL;

-- ─── 2. Comptes bancaires par société ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES bank_companies(id),
  bank_code       text NOT NULL,                -- 'chaabi', 'cih', 'bmce', 'qonto', 'lcl', etc.
  bank_label      text NOT NULL,                -- "Banque Populaire (Chaabi Bank)"
  account_label   text NOT NULL,                -- "STZ OJ - Chaabi Laayoune - Compte courant"
  account_number  text,                          -- numéro IBAN/RIB partiel
  rib             text,                          -- RIB complet (sensible, CEO only en lecture détail)
  currency        text NOT NULL DEFAULT 'MAD',
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

COMMENT ON TABLE bank_accounts IS
  'Comptes bancaires d''une société. 1 compte = 1 société + 1 banque + 1 devise.';

CREATE INDEX idx_bank_accounts_company ON bank_accounts(company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_accounts_bank ON bank_accounts(bank_code) WHERE deleted_at IS NULL;

-- ─── 3. Snapshots de solde manuels ─────────────────────────────────────────
-- À chaque saisie manuelle du CEO/Finance, on crée un nouveau snapshot.
-- Le "solde courant" d'un compte = dernier snapshot par date.
CREATE TABLE IF NOT EXISTS bank_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES bank_accounts(id),
  balance_date   date NOT NULL,                 -- date à laquelle ce solde est arrêté
  balance_amount numeric(14,2) NOT NULL,
  currency       text NOT NULL,                 -- copie de account.currency au moment de la saisie
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import_xlsx', 'import_csv', 'import_pdf')),
  notes          text,
  recorded_by    uuid REFERENCES profiles(id),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bank_balances IS
  'Snapshots de solde par compte. Le solde actuel d''un compte = dernier balance_date.';

CREATE INDEX idx_bank_balances_account_date ON bank_balances(account_id, balance_date DESC);

-- ─── 4. Transactions importées (Chantier 2) ───────────────────────────────
-- Pré-créée mais alimentée seulement à partir du Chantier 2 (parser CSV/XLSX).
CREATE TABLE IF NOT EXISTS bank_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES bank_accounts(id),
  operation_date date NOT NULL,                 -- "Date d'opération" Chaabi
  value_date     date,                          -- "Date Valeur" (peut être NULL pour les opérations en attente)
  label          text NOT NULL,                 -- libellé brut du relevé
  reference      text,                          -- "Référence" Chaabi
  debit_mad      numeric(14,2),                 -- montant débit (positif)
  credit_mad     numeric(14,2),                 -- montant crédit (positif)
  -- Catégorisation auto via préfixes (Chantier 2)
  category_code  text,                          -- ex: 'achat_cb', 'virement_emis', 'virement_recu', 'cheque_emis', 'cheque_recu', 'cnss', 'dgi', 'commission', 'tva', 'maroc_telecom', 'salaire', 'autre'
  beneficiary    text,                          -- nom extrait du libellé (ex: "OUACHAOU TRAVAUX")
  -- État de l'opération
  is_pending     boolean NOT NULL DEFAULT false,  -- true pour les "(*)" en autorisation
  -- Anti-doublons : hash unique par compte+date+ref+montant
  dedup_hash     text NOT NULL,
  -- Audit
  imported_at    timestamptz NOT NULL DEFAULT now(),
  imported_by    uuid REFERENCES profiles(id),
  notes          text,
  deleted_at     timestamptz
);

COMMENT ON TABLE bank_transactions IS
  'Lignes de relevé bancaire importées (CSV/XLSX). Catégorisation auto via préfixes du libellé.';

CREATE UNIQUE INDEX idx_bank_transactions_dedup ON bank_transactions(account_id, dedup_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_transactions_account_date ON bank_transactions(account_id, operation_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_transactions_category ON bank_transactions(category_code) WHERE deleted_at IS NULL;

-- ─── 5. Allocations transaction → projet(s) (Chantier 3) ──────────────────
-- Permet de splitter une transaction bancaire entre 1 ou N projets.
-- Exemple : un achat de mobilier 30k MAD réparti entre 3 projets = 3 allocations.
CREATE TABLE IF NOT EXISTS bank_transaction_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  project_id     uuid REFERENCES projects(id), -- NULL si allocation non-projet (charge structure)
  allocation_type text NOT NULL CHECK (allocation_type IN (
    'travaux',           -- paiement artisan ou encaissement client travaux
    'achats',            -- paiement fournisseur ou encaissement client achats
    'honoraires',        -- échéance honoraires Stoniz
    'propria',           -- prestation propria
    'cabinet_charge',    -- charge cabinet (loyer, salaire, télécom, etc.)
    'cabinet_fiscal',    -- DGI / TVA / impôts
    'cabinet_social',    -- CNSS / charges sociales
    'frais_bancaire',    -- commissions, TVA bancaire
    'intercompany',      -- flux entre STZ OJ ↔ STZ CLUB ↔ ELZ HOLVESTA
    'autre'
  )),
  amount_mad     numeric(14,2) NOT NULL,        -- montant alloué (signé : positif=crédit, négatif=débit selon le projet)
  notes          text,
  allocated_by   uuid REFERENCES profiles(id),
  allocated_at   timestamptz NOT NULL DEFAULT now(),
  -- Lien optionnel vers une ligne précise du suivi projet
  travaux_lot_id   uuid REFERENCES travaux_lots(id),
  achats_lot_id    uuid REFERENCES achats_lots(id),
  payment_id       uuid REFERENCES payments(id),
  deleted_at     timestamptz
);

COMMENT ON TABLE bank_transaction_allocations IS
  'Allocation d''une transaction bancaire vers 1 ou N projets / postes. La somme des allocations doit = montant de la transaction.';

CREATE INDEX idx_allocations_transaction ON bank_transaction_allocations(transaction_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_allocations_project ON bank_transaction_allocations(project_id) WHERE deleted_at IS NULL AND project_id IS NOT NULL;

-- ─── 6. Mapping libellé bancaire → catégorie auto (Chantier 2) ────────────
-- Apprentissage : à la 1ère importation, le CEO/Finance qualifie un virement.
-- Stocké ici, donc les imports suivants matchent automatiquement.
CREATE TABLE IF NOT EXISTS bank_category_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_label_match text NOT NULL,               -- chaîne à matcher (ex: "OUACHAOU TRAVAUX", "AZELMAT ZINEB", "DGI")
  match_type      text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'exact', 'regex')),
  category_code   text NOT NULL,                -- catégorie cible
  allocation_type text,                          -- type d'allocation suggéré (cf allocations)
  -- Lien optionnel vers une entité Stoniz
  linked_profile_id uuid REFERENCES profiles(id),   -- pour les salaires
  linked_artisan_id uuid REFERENCES artisans(id),   -- pour les artisans/fournisseurs récurrents
  linked_project_id uuid REFERENCES projects(id),   -- pour les flux récurrents sur un projet précis
  -- Audit
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (bank_label_match, match_type)
);

COMMENT ON TABLE bank_category_mappings IS
  'Mémoire des qualifications manuelles : permet d''auto-catégoriser les imports suivants.';

CREATE INDEX idx_category_mappings_match ON bank_category_mappings(bank_label_match) WHERE deleted_at IS NULL;

-- ============================================================================
-- RLS — Permissions
-- ============================================================================
ALTER TABLE bank_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transaction_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_category_mappings ENABLE ROW LEVEL SECURITY;

-- Helper : rôle de l'utilisateur connecté
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- Politique : lecture pour CEO + finance + developer
DO $$ BEGIN
  CREATE POLICY tresorerie_select ON bank_companies FOR SELECT
    USING (current_user_role() IN ('ceo','finance','developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_select ON bank_accounts FOR SELECT
    USING (current_user_role() IN ('ceo','finance','developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_select ON bank_balances FOR SELECT
    USING (current_user_role() IN ('ceo','finance','developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_select ON bank_transactions FOR SELECT
    USING (current_user_role() IN ('ceo','finance','developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_select ON bank_transaction_allocations FOR SELECT
    USING (current_user_role() IN ('ceo','finance','developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_select ON bank_category_mappings FOR SELECT
    USING (current_user_role() IN ('ceo','finance','developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Politique : écriture pour CEO + finance (developer en lecture seule)
DO $$ BEGIN
  CREATE POLICY tresorerie_write ON bank_companies FOR ALL
    USING (current_user_role() IN ('ceo','finance'))
    WITH CHECK (current_user_role() IN ('ceo','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_write ON bank_accounts FOR ALL
    USING (current_user_role() IN ('ceo','finance'))
    WITH CHECK (current_user_role() IN ('ceo','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_write ON bank_balances FOR ALL
    USING (current_user_role() IN ('ceo','finance'))
    WITH CHECK (current_user_role() IN ('ceo','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_write ON bank_transactions FOR ALL
    USING (current_user_role() IN ('ceo','finance'))
    WITH CHECK (current_user_role() IN ('ceo','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_write ON bank_transaction_allocations FOR ALL
    USING (current_user_role() IN ('ceo','finance'))
    WITH CHECK (current_user_role() IN ('ceo','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tresorerie_write ON bank_category_mappings FOR ALL
    USING (current_user_role() IN ('ceo','finance'))
    WITH CHECK (current_user_role() IN ('ceo','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- VUE : solde courant par compte (helper pour les dashboards)
-- ============================================================================
CREATE OR REPLACE VIEW v_bank_account_current_balance AS
SELECT DISTINCT ON (a.id)
  a.id              AS account_id,
  a.company_id,
  c.name            AS company_name,
  c.business_unit,
  a.bank_code,
  a.bank_label,
  a.account_label,
  a.currency,
  a.is_active,
  b.balance_amount  AS current_balance,
  b.balance_date    AS balance_date,
  b.recorded_at     AS last_updated,
  b.source          AS balance_source
FROM bank_accounts a
JOIN bank_companies c ON c.id = a.company_id
LEFT JOIN bank_balances b ON b.account_id = a.id
WHERE a.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY a.id, b.balance_date DESC, b.recorded_at DESC;

COMMENT ON VIEW v_bank_account_current_balance IS
  'Solde courant par compte (dernier snapshot manuel ou importé). Source unique pour les dashboards trésorerie.';

GRANT SELECT ON v_bank_account_current_balance TO authenticated;

-- ============================================================================
-- SEED INITIAL : STZ OJ SARL + ses 2 comptes (Chaabi + CIH)
-- ============================================================================
-- Idempotent : ON CONFLICT DO NOTHING pour pouvoir rejouer.

INSERT INTO bank_companies (code, name, legal_name, country_code, currency, business_unit, notes)
VALUES (
  'stz_oj', 'STZ OJ SARL', 'STZ OJ SARL',
  'MA', 'MAD', 'stoniz',
  'Société principale Stoniz clé-en-main. Encaisse les clients, paye artisans+fournisseurs+charges+salaires.'
)
ON CONFLICT (code) DO NOTHING;

-- Comptes pour STZ OJ
WITH stz_oj AS (SELECT id FROM bank_companies WHERE code = 'stz_oj')
INSERT INTO bank_accounts (company_id, bank_code, bank_label, account_label, currency)
SELECT stz_oj.id, 'chaabi', 'Banque Populaire (Chaabi Bank)', 'STZ OJ — Chaabi Laayoune — Compte courant', 'MAD'
FROM stz_oj
WHERE NOT EXISTS (
  SELECT 1 FROM bank_accounts a WHERE a.company_id = stz_oj.id AND a.bank_code = 'chaabi'
);

WITH stz_oj AS (SELECT id FROM bank_companies WHERE code = 'stz_oj')
INSERT INTO bank_accounts (company_id, bank_code, bank_label, account_label, currency)
SELECT stz_oj.id, 'cih', 'CIH Bank', 'STZ OJ — CIH — Compte courant', 'MAD'
FROM stz_oj
WHERE NOT EXISTS (
  SELECT 1 FROM bank_accounts a WHERE a.company_id = stz_oj.id AND a.bank_code = 'cih'
);
