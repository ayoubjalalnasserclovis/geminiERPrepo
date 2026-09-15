-- P&L par projet — table de coefficients de phase + masse salariale cible + overrides
-- CEO 2026-06-30 Phase B1.
--
-- Objectif : permettre la simulation pondérée du P&L par projet en allouant
-- la masse salariale (cabinet_charge + cabinet_fiscal + cabinet_social) aux
-- projets actifs proportionnellement à leur consommation théorique de
-- ressources (pondérée par phase + override par projet).
--
-- 3 tables :
--   • pl_phase_weights              — coefficient global par phase (CEO)
--   • pl_target_payroll_monthly     — masse salariale cible mensuelle (saisie CEO)
--   • project_pl_overrides          — multiplicateur d'override par projet

-- =========================================================================
-- 1. Coefficients globaux par phase (modifiable par CEO)
-- =========================================================================
CREATE TABLE IF NOT EXISTS pl_phase_weights (
  phase project_phase PRIMARY KEY,
  weight numeric(5,2) NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

-- Init valeurs par défaut canon CEO 2026-06-30 :
--   sourcing = 0.3   (avant-projet, peu de consommation)
--   onboarding = 0.3 (même logique que sourcing — démarrage)
--   design = 1.0     (référence — phase nominale)
--   travaux = 2.0    (phase la plus consommatrice de cabinet)
--   livraison = 1.0  (clôture chantier — consommation moyenne)
--   mise_en_location = 0.5 (handover Propria, faible cabinet)
--   termine = 0.0    (projet livré, pas d'allocation)
INSERT INTO pl_phase_weights (phase, weight) VALUES
  ('onboarding',       0.3),
  ('sourcing',         0.3),
  ('design',           1.0),
  ('travaux',          2.0),
  ('livraison',        1.0),
  ('mise_en_location', 0.5),
  ('termine',          0.0)
ON CONFLICT (phase) DO NOTHING;

COMMENT ON TABLE pl_phase_weights IS
  'Coefficients par phase pour le calcul P&L pondéré. CEO 2026-06-30. Voir lib/finance/salary-allocation.ts.';
COMMENT ON COLUMN pl_phase_weights.weight IS
  'Multiplicateur de consommation cabinet par mois passé en phase. 1.0 = nominal, 2.0 = 2× la moyenne.';

-- =========================================================================
-- 2. Masse salariale cible mensuelle (saisie CEO pour validation)
-- =========================================================================
CREATE TABLE IF NOT EXISTS pl_target_payroll_monthly (
  month text PRIMARY KEY,  -- 'YYYY-MM'
  amount_eur numeric(12,2) NOT NULL CHECK (amount_eur >= 0),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

-- Format de mois canonique : YYYY-MM (ex: 2026-06)
ALTER TABLE pl_target_payroll_monthly
  ADD CONSTRAINT pl_target_payroll_monthly_month_format
  CHECK (month ~ '^\d{4}-\d{2}$');

COMMENT ON TABLE pl_target_payroll_monthly IS
  'Masse salariale cible mensuelle EUR — saisie CEO pour comparer à la masse réelle calculée depuis bank_transaction_allocations (cabinet_*). CEO 2026-06-30.';

-- =========================================================================
-- 3. Override par projet (multiplicateur de l'allocation calculée)
-- =========================================================================
CREATE TABLE IF NOT EXISTS project_pl_overrides (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  /** Multiplicateur appliqué après calcul auto. 1.0 = pas d'override.
   *  1.5 = ce projet a consommé 1.5x la moyenne. 0.5 = moins. */
  weight_multiplier numeric(5,2) NOT NULL DEFAULT 1.0
    CHECK (weight_multiplier >= 0 AND weight_multiplier <= 10),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

COMMENT ON TABLE project_pl_overrides IS
  'Override par projet sur le calcul auto pondéré. Pour les cas exceptionnels (projet chronophage, lost à mi-chemin, complexité). CEO 2026-06-30.';

-- =========================================================================
-- RLS — ces tables sont lues partout, écrites par CEO + finance uniquement
-- =========================================================================
ALTER TABLE pl_phase_weights              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_target_payroll_monthly     ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_pl_overrides          ENABLE ROW LEVEL SECURITY;

-- Lecture pour tout utilisateur authentifié (les permissions fines sont
-- gérées côté app — voir canSeeFinancials helper).
DROP POLICY IF EXISTS pl_phase_weights_read ON pl_phase_weights;
CREATE POLICY pl_phase_weights_read ON pl_phase_weights
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pl_target_payroll_monthly_read ON pl_target_payroll_monthly;
CREATE POLICY pl_target_payroll_monthly_read ON pl_target_payroll_monthly
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS project_pl_overrides_read ON project_pl_overrides;
CREATE POLICY project_pl_overrides_read ON project_pl_overrides
  FOR SELECT TO authenticated USING (true);

-- Écriture : CEO + finance + developer (lecture-only sur destructif)
-- La policy app-side restera la garde principale ; ici on bloque les rôles
-- terrain (chef_projet, achats, propria, menage) au niveau BDD.
DROP POLICY IF EXISTS pl_phase_weights_write ON pl_phase_weights;
CREATE POLICY pl_phase_weights_write ON pl_phase_weights
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ceo', 'finance', 'developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ceo', 'finance', 'developer')
    )
  );

DROP POLICY IF EXISTS pl_target_payroll_monthly_write ON pl_target_payroll_monthly;
CREATE POLICY pl_target_payroll_monthly_write ON pl_target_payroll_monthly
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ceo', 'finance', 'developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ceo', 'finance', 'developer')
    )
  );

DROP POLICY IF EXISTS project_pl_overrides_write ON project_pl_overrides;
CREATE POLICY project_pl_overrides_write ON project_pl_overrides
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ceo', 'finance', 'developer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ceo', 'finance', 'developer')
    )
  );
