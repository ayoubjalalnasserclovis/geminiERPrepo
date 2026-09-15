-- ============================================================================
-- ACHATS — Page Estimations (CEO 2026-08-19, session B roadmap évolutions)
-- ============================================================================
-- Besoin : l'acheteur estime le coût d'un produit AVANT de le confirmer dans
-- le suivi achat réel. Contrainte clé du cahier des charges : cloisonnement
-- TOTAL — aucune donnée de cette table n'entre jamais dans les calculs,
-- totaux ou dashboards du suivi réel. Le cloisonnement est STRUCTUREL :
-- table séparée, jamais lue par lib/finance/achats-calc.ts ni aucun dashboard
-- réel. Les dashboards de la page Estimations lisent UNIQUEMENT cette table
-- (+ le lot réel converti pour l'écart estimé vs réel).
--
-- Cycle de vie d'une ligne : estime → converti (crée le lot réel, verrouille
-- la ligne, converted_lot_id UNIQUE = pas de double conversion possible en
-- BDD) ou estime → abandonne (traçable, réactivable).
--
-- Décision CEO 2026-08-19 : à la conversion, le prix estimé pré-remplit le
-- DEVIS PRÉVISIONNEL (budget_estimate_mad) du lot réel. Le devis fournisseur
-- reste vide jusqu'au vrai devis signé — une estimation reste un prévisionnel.
--
-- Fournisseur OPTIONNEL (contrairement aux lots réels) : à ce stade
-- l'acheteur ne sait pas toujours chez qui il achètera.

BEGIN;

CREATE TABLE IF NOT EXISTS achats_estimations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,

  -- Même liste de catégories que achats_lots (cohérence de lecture)
  category TEXT NOT NULL CHECK (category IN (
    'mobilier_salon','mobilier_chambre','mobilier_sdb','mobilier_cuisine',
    'electromenager','luminaire','textile_decoration',
    'vaisselle_arts_table','linge_maison',
    'plomberie_robinetterie','sanitaires','peinture_fournitures',
    'carrelage_marbre','menuiserie_fournitures',
    'jardinage_exterieur','divers'
  )),
  description TEXT,

  -- Fournisseur pressenti — optionnel à ce stade
  supplier_name TEXT,
  supplier_id UUID REFERENCES artisans(id) ON DELETE SET NULL,

  -- Chiffrage estimé (MAD). prix_estime_mad = montant total estimé de la
  -- ligne. quantity × unit_price_mad = aide de saisie (pré-remplissage côté
  -- formulaire, même convention que achats_lots — pas une dérivation stockée).
  quantity NUMERIC(10,2),
  unit_price_mad NUMERIC(14,2),
  prix_estime_mad NUMERIC(14,2),

  -- Suite locative visée (NULL = bien global / parties communes)
  propria_unit_id UUID REFERENCES propria_units(id) ON DELETE SET NULL,

  notes TEXT,

  -- Cycle de vie
  status TEXT NOT NULL DEFAULT 'estime' CHECK (status IN ('estime','converti','abandonne')),
  converted_lot_id UUID UNIQUE REFERENCES achats_lots(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  converted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicité du numéro par projet, hors soft-deleted (même convention que le
-- correctif 20260630130000 sur achats_lots)
CREATE UNIQUE INDEX IF NOT EXISTS achats_estimations_project_numero_key
  ON achats_estimations (project_id, numero) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS achats_estimations_project_idx
  ON achats_estimations (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS achats_estimations_unit_idx
  ON achats_estimations (propria_unit_id) WHERE deleted_at IS NULL;

CREATE TRIGGER achats_estimations_set_updated_at BEFORE UPDATE ON achats_estimations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS — miroir exact de achats_lots ────────────────────────────────────
ALTER TABLE achats_estimations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS achats_estimations_staff ON achats_estimations;
CREATE POLICY achats_estimations_staff ON achats_estimations FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance','assistante']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance','assistante']));

-- Rôle achats (même pattern que 20260614120000_version_achats_role_rls_drift)
DROP POLICY IF EXISTS achats_read_achats_estimations ON achats_estimations;
CREATE POLICY achats_read_achats_estimations ON achats_estimations FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
DROP POLICY IF EXISTS achats_update_achats_estimations ON achats_estimations;
CREATE POLICY achats_update_achats_estimations ON achats_estimations FOR UPDATE
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
DROP POLICY IF EXISTS achats_write_achats_estimations ON achats_estimations;
CREATE POLICY achats_write_achats_estimations ON achats_estimations FOR INSERT
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');

COMMENT ON TABLE achats_estimations IS
  'Estimations budgétaires achats par projet — CLOISONNÉES du suivi réel (jamais lues par les KPI réels). Conversion en lot réel via converted_lot_id (UNIQUE = anti double conversion).';
COMMENT ON COLUMN achats_estimations.prix_estime_mad IS
  'Montant total estimé de la ligne en MAD. À la conversion, pré-remplit budget_estimate_mad (Devis prévisionnel) du lot réel créé.';
COMMENT ON COLUMN achats_estimations.converted_lot_id IS
  'Lot réel créé par la conversion. UNIQUE : une estimation ne peut être convertie qu''une fois, un lot ne provient que d''une estimation.';

COMMIT;

-- ─── Audit : autoriser 'achats_estimations' dans finance_audit_log ─────────
-- (même pattern que 20260630120000 — la contrainte CHECK liste les tables)
BEGIN;

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
    'achats_estimations'::text
  ]));

COMMIT;
