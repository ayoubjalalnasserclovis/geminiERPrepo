-- ============================================================================
-- Workflow de validation des sorties de cash (paiements artisans, fournisseurs,
-- honoraires Stoniz). 2 niveaux : Finance (optionnel) -> CEO (obligatoire).
-- Une seule table polymorphique vers les 3 tables de paiements existantes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference polymorphique : EXACTEMENT un des trois est rempli
  payment_id          UUID REFERENCES payments(id) ON DELETE CASCADE,
  travaux_payment_id  UUID REFERENCES travaux_payments(id) ON DELETE CASCADE,
  achats_payment_id   UUID REFERENCES achats_payments(id) ON DELETE CASCADE,

  -- Contexte (denormalise pour affichage rapide en inbox)
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  amount              NUMERIC(14,2) NOT NULL,
  currency            CHAR(3) NOT NULL DEFAULT 'EUR',
  beneficiary_name    TEXT NOT NULL,        -- artisan/fournisseur/Stoniz lui-meme
  description         TEXT,                  -- ex: "Acompte 2 maconnerie - lot 3"
  urgency             TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),

  -- Demande
  requested_by        UUID REFERENCES profiles(id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_notes       TEXT,

  -- Etape 1 : Finance (optionnelle)
  finance_status      TEXT NOT NULL DEFAULT 'pending' CHECK (finance_status IN ('pending','approved','rejected','skipped')),
  finance_reviewer    UUID REFERENCES profiles(id),
  finance_reviewed_at TIMESTAMPTZ,
  finance_notes       TEXT,

  -- Etape 2 : CEO (obligatoire pour passer en payed)
  ceo_status          TEXT NOT NULL DEFAULT 'pending' CHECK (ceo_status IN ('pending','approved','rejected')),
  ceo_reviewer        UUID REFERENCES profiles(id),
  ceo_reviewed_at     TIMESTAMPTZ,
  ceo_notes           TEXT,

  -- Statut final agrégé (utile pour les filtres)
  final_status        TEXT GENERATED ALWAYS AS (
    CASE
      WHEN ceo_status = 'approved'    THEN 'approved'
      WHEN ceo_status = 'rejected'    THEN 'rejected'
      WHEN finance_status = 'rejected' THEN 'rejected'
      ELSE 'pending'
    END
  ) STORED,

  -- Execution (virement effectif)
  paid_at             TIMESTAMPTZ,
  paid_by             UUID REFERENCES profiles(id),
  payment_method      TEXT,                  -- virement, espèces, chèque...
  payment_reference   TEXT,                  -- N° de virement / IBAN...
  proof_doc_id        UUID REFERENCES documents(id),

  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactement UN paiement source
  CONSTRAINT one_source_only CHECK (
    (CASE WHEN payment_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN travaux_payment_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN achats_payment_id  IS NULL THEN 0 ELSE 1 END) = 1
  )
);

CREATE INDEX IF NOT EXISTS payment_approvals_final_status_idx
  ON payment_approvals (final_status, requested_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_approvals_finance_pending_idx
  ON payment_approvals (finance_status) WHERE finance_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_approvals_ceo_pending_idx
  ON payment_approvals (ceo_status)
  WHERE ceo_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_approvals_project_idx
  ON payment_approvals (project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_approvals_requested_by_idx
  ON payment_approvals (requested_by) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_approvals_one_per_payment
  ON payment_approvals (payment_id) WHERE payment_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_approvals_one_per_travaux
  ON payment_approvals (travaux_payment_id) WHERE travaux_payment_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_approvals_one_per_achats
  ON payment_approvals (achats_payment_id) WHERE achats_payment_id IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS payment_approvals_set_updated_at ON payment_approvals;
CREATE TRIGGER payment_approvals_set_updated_at BEFORE UPDATE ON payment_approvals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Type de document : preuve de virement ────────────────────────────────
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
    'attestation_regularite_fiscale','attestation_rib','attestation_cnss','attestation_assurance',
    'cahier_des_charges',
    'preuve_virement',
    'autre'
  ));

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE payment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pa_insert_team ON payment_approvals;
CREATE POLICY pa_insert_team ON payment_approvals FOR INSERT
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing','commercial','finance']));

DROP POLICY IF EXISTS pa_select_team ON payment_approvals;
CREATE POLICY pa_select_team ON payment_approvals FOR SELECT
  USING (
    -- CEO et Finance voient tout
    is_staff(ARRAY['ceo','finance'])
    -- Autres staff voient leurs propres demandes uniquement
    OR (is_staff() AND requested_by = auth.uid())
  );

DROP POLICY IF EXISTS pa_update_staff ON payment_approvals;
CREATE POLICY pa_update_staff ON payment_approvals FOR UPDATE
  USING (is_staff(ARRAY['ceo','finance']))
  WITH CHECK (is_staff(ARRAY['ceo','finance']));

DROP POLICY IF EXISTS pa_delete_ceo ON payment_approvals;
CREATE POLICY pa_delete_ceo ON payment_approvals FOR DELETE
  USING (is_staff(ARRAY['ceo']));

COMMENT ON TABLE payment_approvals IS
  'Workflow validation paiements : demande -> Finance (optionnel) -> CEO -> paye. Polymorphique vers payments / travaux_payments / achats_payments.';
