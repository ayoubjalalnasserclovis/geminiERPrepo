-- ============================================================================
-- Module ACHATS (mobilier / deco / equipement / fournitures)
-- Calque sur travaux : lots + paiements (acomptes/soldes) + encaissements client
--
-- "Achats" = tout ce qu'on achete pour livrer le bien (canapes, lits, vaisselle,
-- electromenager, luminaires, deco). Distinct des "Travaux" (main d'oeuvre).
-- ============================================================================

-- Extension du type artisan pour inclure "fournisseur" (vendeurs de biens)
ALTER TABLE artisans DROP CONSTRAINT IF EXISTS artisans_type_check;
ALTER TABLE artisans ADD CONSTRAINT artisans_type_check
  CHECK (type IN (
    'artisan_local','entreprise_generale','sous_traitant_ext',
    'fournisseur','grossiste','importateur',
    'autre'
  ));

-- ─── Champs projet pour le suivi achats ────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS achats_budget_mad NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS achats_marge_cible_pct NUMERIC(5,2) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS achats_adresse_livraison TEXT;

-- ─── Table achats_lots (1 lot = 1 fournisseur OU 1 categorie d'achats) ────
CREATE TABLE IF NOT EXISTS achats_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'mobilier_salon','mobilier_chambre','mobilier_sdb','mobilier_cuisine',
    'electromenager','luminaire','textile_decoration',
    'vaisselle_arts_table','linge_maison',
    'plomberie_robinetterie','sanitaires','peinture_fournitures',
    'carrelage_marbre','menuiserie_fournitures',
    'jardinage_exterieur','divers'
  )),
  description TEXT,

  -- Fournisseur (texte libre + FK optionnelle vers artisans)
  supplier_name TEXT NOT NULL,
  supplier_id UUID REFERENCES artisans(id) ON DELETE SET NULL,
  devis_number TEXT,

  -- Montants en MAD
  budget_estimate_mad NUMERIC(14,2),    -- budget alloue initialement
  devis_fournisseur_mad NUMERIC(14,2),  -- ce qu'on doit payer au fournisseur
  facture_client_mad NUMERIC(14,2),     -- ce qu'on facture au client (avec marge)

  status TEXT NOT NULL DEFAULT 'a_commander' CHECK (status IN (
    'a_commander','devis_recu','commande','en_livraison','livre','installe','annule'
  )),

  date_commande DATE,
  date_livraison_estimee DATE,
  date_livraison_reelle DATE,

  notes TEXT,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (project_id, numero)
);

CREATE INDEX IF NOT EXISTS achats_lots_project_idx
  ON achats_lots (project_id, numero) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS achats_lots_supplier_idx
  ON achats_lots (supplier_id) WHERE deleted_at IS NULL;

CREATE TRIGGER achats_lots_set_updated_at BEFORE UPDATE ON achats_lots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Table achats_payments (acomptes / soldes verses aux fournisseurs) ────
CREATE TABLE IF NOT EXISTS achats_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lot_id UUID REFERENCES achats_lots(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  supplier_id UUID REFERENCES artisans(id) ON DELETE SET NULL,
  category TEXT,
  description TEXT,

  currency CHAR(3) NOT NULL DEFAULT 'MAD',
  amount_total NUMERIC(14,2) NOT NULL,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  exchange_rate_eur NUMERIC(10,6),
  exchange_rate_at TIMESTAMPTZ,
  amount_total_eur NUMERIC(14,2) GENERATED ALWAYS AS (
    CASE WHEN exchange_rate_eur IS NOT NULL AND exchange_rate_eur > 0
      THEN ROUND(amount_total / exchange_rate_eur, 2)
      ELSE NULL END
  ) STORED,

  payment_type TEXT CHECK (payment_type IN ('acompte','solde','autre')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid')),
  acompte_number INTEGER CHECK (acompte_number BETWEEN 1 AND 6),
  acompte_pct NUMERIC(5,2),

  scheduled_date DATE,
  paid_at DATE,
  notes TEXT,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (amount_paid >= 0 AND amount_paid <= amount_total * 1.05)
);

CREATE INDEX IF NOT EXISTS achats_payments_project_status_idx
  ON achats_payments (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS achats_payments_lot_idx
  ON achats_payments (lot_id, acompte_number) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS achats_payments_scheduled_idx
  ON achats_payments (scheduled_date) WHERE status <> 'paid' AND deleted_at IS NULL;

CREATE TRIGGER achats_payments_set_updated_at BEFORE UPDATE ON achats_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Table achats_encaissements (client → Stoniz pour les achats) ─────────
CREATE TABLE IF NOT EXISTS achats_encaissements (
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

CREATE INDEX IF NOT EXISTS achats_encaissements_project_idx
  ON achats_encaissements (project_id, received_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER achats_encaissements_set_updated_at BEFORE UPDATE ON achats_encaissements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Documents : achat_lot_id + nouveaux types devis/facture fournisseur ──
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS achat_lot_id UUID REFERENCES achats_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_achat_lot_idx
  ON documents (achat_lot_id) WHERE deleted_at IS NULL;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'devis_artisan','facture_artisan',
    'devis_fournisseur','facture_fournisseur','bon_commande',
    'autre'
  ));

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE achats_lots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE achats_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE achats_encaissements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS achats_lots_staff ON achats_lots;
CREATE POLICY achats_lots_staff ON achats_lots FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance','assistante']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance','assistante']));

DROP POLICY IF EXISTS achats_payments_staff ON achats_payments;
CREATE POLICY achats_payments_staff ON achats_payments FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance']));

DROP POLICY IF EXISTS achats_encaissements_staff ON achats_encaissements;
CREATE POLICY achats_encaissements_staff ON achats_encaissements FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance']));

COMMENT ON TABLE achats_lots IS
  'Lots d''achats (mobilier, deco, equipement) par projet. 1 lot = 1 fournisseur ou 1 categorie.';
COMMENT ON TABLE achats_payments IS
  'Paiements fournisseurs en MAD avec jusqu''a 6 acomptes par lot, taux fixe 10 MAD/EUR.';
COMMENT ON TABLE achats_encaissements IS
  'Versements du client vers Stoniz pour financer les achats (distinct des honoraires).';
