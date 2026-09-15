-- ============================================================================
-- Caisses STONIZ — distinctes des caisses Propria
-- ============================================================================
-- Tracker les paiements en espèces côté STONIZ (achats projets, travaux cash).
-- Logique miroir de la caisse Propria :
--   - Dotations : seul le CEO peut distribuer du cash
--   - Dépenses  : tout staff autorisé peut enregistrer, justificatif obligatoire pour valider
--   - Validation: seul le CEO valide (vérifie la PJ)
-- Différences :
--   - Pas de property_id (Propria) mais project_id (projet client)
--   - expense_type ∈ {'achat','travaux','autre'} → permet de splitter le P&L projet
-- ============================================================================

-- ─── 1. Caisses (wallets) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stoniz_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id),
  label TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  closed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stoniz_wallets_profile_idx ON stoniz_wallets (profile_id) WHERE is_active = true;

CREATE TRIGGER stoniz_wallets_updated_at BEFORE UPDATE ON stoniz_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. Dotations (cash remis au collaborateur par le CEO) ─────────────────
CREATE TABLE IF NOT EXISTS stoniz_wallet_dotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES stoniz_wallets(id) ON DELETE CASCADE,
  given_at DATE NOT NULL,
  amount_mad NUMERIC(12,2) NOT NULL CHECK (amount_mad > 0),
  type TEXT NOT NULL DEFAULT 'dotation' CHECK (type IN ('dotation','rechargement')),
  given_by UUID REFERENCES profiles(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stoniz_wallet_dotations_wallet_idx
  ON stoniz_wallet_dotations (wallet_id, given_at DESC);

-- ─── 3. Dépenses ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stoniz_wallet_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES stoniz_wallets(id) ON DELETE CASCADE,
  spent_at DATE NOT NULL,
  project_id UUID REFERENCES projects(id),         -- projet rattaché (nullable: générique)
  expense_type TEXT NOT NULL CHECK (expense_type IN ('achat','travaux','autre')),
  category TEXT,                                    -- libre (ex: "Quincaillerie", "Tirage plans")
  description TEXT NOT NULL,
  amount_mad NUMERIC(12,2) NOT NULL CHECK (amount_mad > 0),
  receipt_path TEXT,                                -- justificatif (Supabase storage)
  is_validated BOOLEAN NOT NULL DEFAULT false,
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES profiles(id),
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stoniz_wallet_expenses_wallet_idx
  ON stoniz_wallet_expenses (wallet_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS stoniz_wallet_expenses_project_idx
  ON stoniz_wallet_expenses (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stoniz_wallet_expenses_type_idx
  ON stoniz_wallet_expenses (expense_type);
CREATE INDEX IF NOT EXISTS stoniz_wallet_expenses_validation_idx
  ON stoniz_wallet_expenses (is_validated);

CREATE TRIGGER stoniz_wallet_expenses_updated_at BEFORE UPDATE ON stoniz_wallet_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 4. Vue solde par caisse ───────────────────────────────────────────────
CREATE OR REPLACE VIEW stoniz_wallet_balances AS
SELECT
  w.id AS wallet_id,
  w.profile_id,
  w.label,
  COALESCE(d.total_dotations, 0)::numeric  AS total_dotations,
  COALESCE(e.total_expenses, 0)::numeric   AS total_expenses,
  COALESCE(e.total_validated, 0)::numeric  AS total_validated,
  (COALESCE(e.total_expenses, 0) - COALESCE(e.total_validated, 0))::numeric AS total_unvalidated,
  (COALESCE(d.total_dotations, 0) - COALESCE(e.total_expenses, 0))::numeric AS solde_mad
FROM stoniz_wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_mad) AS total_dotations
  FROM stoniz_wallet_dotations GROUP BY wallet_id
) d ON d.wallet_id = w.id
LEFT JOIN (
  SELECT
    wallet_id,
    SUM(amount_mad) AS total_expenses,
    SUM(CASE WHEN is_validated = true THEN amount_mad ELSE 0 END) AS total_validated
  FROM stoniz_wallet_expenses GROUP BY wallet_id
) e ON e.wallet_id = w.id;

ALTER VIEW stoniz_wallet_balances SET (security_invoker = on);

-- ─── 5. Vue P&L cash par projet (split achat vs travaux) ───────────────────
-- Utilisée pour le calcul des marges projet : ventile le cash STONIZ
-- sur la partie achat et la partie travaux du projet.
CREATE OR REPLACE VIEW stoniz_project_cash_pl AS
SELECT
  project_id,
  SUM(CASE WHEN expense_type = 'achat'   THEN amount_mad ELSE 0 END)::numeric AS cash_achat_mad,
  SUM(CASE WHEN expense_type = 'travaux' THEN amount_mad ELSE 0 END)::numeric AS cash_travaux_mad,
  SUM(CASE WHEN expense_type = 'autre'   THEN amount_mad ELSE 0 END)::numeric AS cash_autre_mad,
  SUM(amount_mad)::numeric AS cash_total_mad,
  SUM(CASE WHEN is_validated THEN amount_mad ELSE 0 END)::numeric AS cash_total_validated_mad
FROM stoniz_wallet_expenses
WHERE project_id IS NOT NULL
GROUP BY project_id;

ALTER VIEW stoniz_project_cash_pl SET (security_invoker = on);

-- ─── 6. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE stoniz_wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stoniz_wallet_dotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stoniz_wallet_expenses     ENABLE ROW LEVEL SECURITY;

-- Lecture : staff autorisé (ceo, chef_projet, finance, assistante)
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY['stoniz_wallets','stoniz_wallet_dotations','stoniz_wallet_expenses'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_read ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_read ON %I FOR SELECT USING (is_staff(ARRAY[''ceo'',''chef_projet'',''finance'',''assistante'']));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_write ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_write ON %I FOR INSERT WITH CHECK (is_staff(ARRAY[''ceo'',''chef_projet'',''finance'',''assistante'']));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_update ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_update ON %I FOR UPDATE USING (is_staff(ARRAY[''ceo'',''chef_projet'',''finance'',''assistante''])) WITH CHECK (is_staff(ARRAY[''ceo'',''chef_projet'',''finance'',''assistante'']));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_delete ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_delete ON %I FOR DELETE USING (is_staff(ARRAY[''ceo'']));',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ─── 7. Audit triggers ─────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY['stoniz_wallets','stoniz_wallet_dotations','stoniz_wallet_expenses'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger();',
      tbl, tbl
    );
  END LOOP;
END $$;

COMMENT ON TABLE stoniz_wallets IS 'Caisses cash STONIZ (distinct de Propria). 1 caisse = 1 collaborateur.';
COMMENT ON TABLE stoniz_wallet_dotations IS 'Dotations cash STONIZ. Réservé au CEO côté action serveur.';
COMMENT ON TABLE stoniz_wallet_expenses IS 'Dépenses cash STONIZ. expense_type=achat/travaux/autre pour le P&L projet.';
COMMENT ON VIEW stoniz_project_cash_pl IS 'P&L cash STONIZ ventilé par projet et type (achat vs travaux).';
