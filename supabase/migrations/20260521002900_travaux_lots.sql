-- ============================================================================
-- Système de suivi travaux structuré par LOTS
-- - travaux_lots : 1 lot = 1 artisan, jusqu'à 6 acomptes
-- - travaux_payments : étendu avec lot_id et acompte_number
-- - travaux_encaissements : encaissements client travaux (séparés des honoraires Stoniz)
-- ============================================================================

-- ─── Champs projet pour le suivi travaux ────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS travaux_budget_mad NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS travaux_marge_cible_pct NUMERIC(5,2) DEFAULT 30,
  ADD COLUMN IF NOT EXISTS travaux_adresse_chantier TEXT;

-- ─── Table travaux_lots ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS travaux_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,                          -- N° dans le projet (1, 2, 3...)
  category TEXT NOT NULL CHECK (category IN (
    'demolition_cloisons','gros_oeuvre_maconnerie','electricite','plomberie_sanitaire',
    'carrelage_revetements','menuiserie_interieure','menuiserie_aluminium',
    'peinture','faux_plafond','climatisation_vmc','ferronnerie',
    'amenagements_exterieurs','cuisine','divers'
  )),
  description TEXT,
  artisan_name TEXT NOT NULL,
  artisan_type TEXT CHECK (artisan_type IN (
    'artisan_local','entreprise_generale','sous_traitant_ext','autre'
  )),
  devis_number TEXT,

  -- Montants en MAD
  budget_estimate_mad NUMERIC(14,2),    -- budget alloué initialement
  devis_artisan_mad   NUMERIC(14,2),    -- ce qu'on doit payer à l'artisan
  facture_client_mad  NUMERIC(14,2),    -- ce qu'on facture au client

  status TEXT NOT NULL DEFAULT 'a_planifier' CHECK (status IN (
    'a_planifier','devis_recu','demarre','en_cours','en_attente','termine','annule'
  )),

  date_debut_estime DATE,
  date_fin_estimee  DATE,
  date_fin_reelle   DATE,

  notes TEXT,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (project_id, numero)
);

CREATE INDEX IF NOT EXISTS travaux_lots_project_idx
  ON travaux_lots (project_id, numero) WHERE deleted_at IS NULL;

CREATE TRIGGER travaux_lots_set_updated_at BEFORE UPDATE ON travaux_lots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER audit_travaux_lots
  AFTER INSERT OR UPDATE OR DELETE ON travaux_lots
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ─── Extension travaux_payments : lien vers lot + acompte ───────────────────
ALTER TABLE travaux_payments
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES travaux_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acompte_number INTEGER CHECK (acompte_number BETWEEN 1 AND 6),
  ADD COLUMN IF NOT EXISTS acompte_pct NUMERIC(5,2);

CREATE INDEX IF NOT EXISTS travaux_payments_lot_idx
  ON travaux_payments (lot_id, acompte_number) WHERE lot_id IS NOT NULL;

-- ─── Table travaux_encaissements (client → Stoniz pour travaux) ────────────
CREATE TABLE IF NOT EXISTS travaux_encaissements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount_mad NUMERIC(14,2) NOT NULL,
  received_at DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS travaux_encaissements_project_idx
  ON travaux_encaissements (project_id, received_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER travaux_encaissements_set_updated_at BEFORE UPDATE ON travaux_encaissements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE travaux_lots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE travaux_encaissements ENABLE ROW LEVEL SECURITY;

CREATE POLICY travaux_lots_staff ON travaux_lots FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance']));

CREATE POLICY travaux_encaissements_staff ON travaux_encaissements FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance']));
