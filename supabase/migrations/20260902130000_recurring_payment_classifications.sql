-- Classification des paiements recurrents detectes (CEO 2026-09-02)
-- Le detecteur trouve des beneficiaires payes recurremment (Nabil, Zineb,
-- Ark Atelier, Geo Metra, etc.). Le CEO veut pouvoir dire :
--   - Nabil, Zineb, Chakib, Habiba -> SALAIRE
--   - Ark Atelier, Geo Metra -> PRESTATAIRE
--   - Autres cas possibles : loyer, abonnement, ignore
--
-- Impact :
--   - Ventilation dans /finance/synthese (masse salariale / prestataires / etc.)
--   - Type 'ignore' -> exclu du total recurrent (permet d'ecarter les faux positifs)
--
-- Migration deja appliquee en prod le 2026-09-02 avec seed initial.

DO $$ BEGIN
  CREATE TYPE recurring_payment_type_t AS ENUM
    ('salaire', 'prestataire', 'loyer', 'abonnement', 'autre', 'ignore');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.recurring_payment_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_normalized text NOT NULL UNIQUE,
  beneficiary_display text NOT NULL,
  type recurring_payment_type_t NOT NULL DEFAULT 'autre',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS recurring_payment_classifications_type_idx
  ON public.recurring_payment_classifications (type);

COMMENT ON TABLE public.recurring_payment_classifications IS
  'Classification manuelle des benef recurrents (salaire/prestataire/loyer/...) CEO 2026-09-02.';

ALTER TABLE public.recurring_payment_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_class_select ON public.recurring_payment_classifications;
CREATE POLICY recurring_class_select ON public.recurring_payment_classifications
  FOR SELECT USING (current_user_role() = ANY (ARRAY['ceo','finance','developer']));

DROP POLICY IF EXISTS recurring_class_write ON public.recurring_payment_classifications;
CREATE POLICY recurring_class_write ON public.recurring_payment_classifications
  FOR ALL USING (current_user_role() = ANY (ARRAY['ceo','finance']))
  WITH CHECK (current_user_role() = ANY (ARRAY['ceo','finance']));

-- Seed initial (6 classifications confirmees par le CEO)
INSERT INTO public.recurring_payment_classifications
  (beneficiary_normalized, beneficiary_display, type, notes)
VALUES
  ('GANDOUL NABIL', 'GANDOUL NABIL', 'salaire', 'Confirme CEO 2026-09-02'),
  ('AZELMAT ZINEB', 'AZELMAT ZINEB', 'salaire', 'Confirme CEO 2026-09-02'),
  ('FERJIJ CHAKIB', 'FERJIJ CHAKIB', 'salaire', 'Confirme CEO 2026-09-02'),
  ('EL BOUGHADI HABIBA', 'EL BOUGHADI HABIBA', 'salaire', 'Confirme CEO 2026-09-02'),
  ('ARK ATELIER', 'ARK ATELIER', 'prestataire', 'Confirme CEO 2026-09-02'),
  ('GEO METRA', 'GEO METRA', 'prestataire', 'Confirme CEO 2026-09-02')
ON CONFLICT (beneficiary_normalized) DO NOTHING;
