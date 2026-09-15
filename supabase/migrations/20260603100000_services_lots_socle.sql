-- ============================================================================
-- 3e pôle Services / Prestataires (CEO 2026-06-03)
-- ============================================================================
-- À côté de Travaux (artisans qui exécutent) et Achats (fournisseurs de
-- mobilier/équipement), on ajoute un pôle Services pour les prestataires
-- intellectuels rattachés à un projet : architecte, géomètre, juridique,
-- photo/vidéo, décoration, marketing, conseil, etc.
--
-- Décision CEO 2026-06-03 :
--   - Stoniz paye ces services ET c'est inclus dans les honoraires (pas
--     refacturé au client). Donc côté business : c'est un COÛT pur qui
--     pèse sur la marge cabinet par projet.
--   - Suivi PAR PRESTATAIRE (1 lot = 1 prestataire) comme travaux/achats.
--   - On étend la table `artisans` plutôt que créer une nouvelle table
--     (mêmes outils de gestion, on ajoute juste un champ provider_type).
-- ============================================================================

ALTER TABLE public.artisans
  ADD COLUMN IF NOT EXISTS provider_type text NOT NULL DEFAULT 'artisan_travaux'
    CHECK (provider_type IN ('artisan_travaux', 'fournisseur_achats', 'prestataire_service'));

ALTER TABLE public.artisans
  ADD COLUMN IF NOT EXISTS service_category text
    CHECK (service_category IS NULL OR service_category IN (
      'architecte', 'geometre', 'bureau_etudes', 'juridique_notariat',
      'photo_video', 'decoration_design', 'marketing_communication',
      'conseil', 'autre_service'
    ));

CREATE INDEX IF NOT EXISTS idx_artisans_provider_type ON public.artisans(provider_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artisans_service_category ON public.artisans(service_category) WHERE deleted_at IS NULL AND service_category IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.services_lots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.projects(id),
  provider_id           uuid REFERENCES public.artisans(id),
  service_category      text NOT NULL CHECK (service_category IN (
    'architecte','geometre','bureau_etudes','juridique_notariat',
    'photo_video','decoration_design','marketing_communication',
    'conseil','autre_service'
  )),
  budget_estimate_mad   numeric(14,2),
  devis_prestataire_mad numeric(14,2),
  facture_prestataire_mad numeric(14,2),
  status                text NOT NULL DEFAULT 'a_planifier' CHECK (status IN (
    'a_planifier','devis_recu','en_cours','livre','termine','annule'
  )),
  description           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_services_lots_project ON public.services_lots(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_services_lots_provider ON public.services_lots(provider_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_services_lots_category ON public.services_lots(service_category) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.services_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id),
  lot_id          uuid REFERENCES public.services_lots(id),
  provider_id     uuid REFERENCES public.artisans(id),
  acompte_index   smallint CHECK (acompte_index IS NULL OR (acompte_index BETWEEN 1 AND 6)),
  scheduled_date  date,
  paid_at         date,
  amount_total    numeric(14,2),
  amount_paid     numeric(14,2),
  status          text NOT NULL DEFAULT 'planifie' CHECK (status IN (
    'planifie','partiel','paye','annule'
  )),
  description     text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_services_payments_project ON public.services_payments(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_services_payments_lot ON public.services_payments(lot_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_services_payments_provider ON public.services_payments(provider_id) WHERE deleted_at IS NULL;

ALTER TABLE public.bank_transaction_allocations
  ADD COLUMN IF NOT EXISTS services_lot_id uuid REFERENCES public.services_lots(id);

ALTER TABLE public.bank_transaction_allocations
  ADD COLUMN IF NOT EXISTS services_payment_id uuid REFERENCES public.services_payments(id);

ALTER TABLE public.bank_transaction_allocations
  DROP CONSTRAINT IF EXISTS bank_transaction_allocations_allocation_type_check;
ALTER TABLE public.bank_transaction_allocations
  ADD CONSTRAINT bank_transaction_allocations_allocation_type_check
  CHECK (allocation_type IN (
    'travaux','achats','services','honoraires','propria',
    'cabinet_charge','cabinet_fiscal','cabinet_social',
    'frais_bancaire','intercompany','autre'
  ));

CREATE INDEX IF NOT EXISTS idx_allocations_services_lot ON public.bank_transaction_allocations(services_lot_id) WHERE deleted_at IS NULL AND services_lot_id IS NOT NULL;

ALTER TABLE public.services_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY services_lots_select ON public.services_lots FOR SELECT
    USING (current_user_role() IN ('ceo','chef_projet','finance','developer','assistante'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY services_lots_write ON public.services_lots FOR ALL
    USING (current_user_role() IN ('ceo','chef_projet','finance'))
    WITH CHECK (current_user_role() IN ('ceo','chef_projet','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY services_payments_select ON public.services_payments FOR SELECT
    USING (current_user_role() IN ('ceo','chef_projet','finance','developer','assistante'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY services_payments_write ON public.services_payments FOR ALL
    USING (current_user_role() IN ('ceo','chef_projet','finance'))
    WITH CHECK (current_user_role() IN ('ceo','chef_projet','finance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
