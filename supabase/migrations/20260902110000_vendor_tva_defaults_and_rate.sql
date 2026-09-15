-- Memoire TVA par beneficiaire + taux variable par transaction (CEO 2026-09-02).
--
-- Objectif : quand le CEO override le traitement TVA d'une transaction d'un
-- beneficiaire donne (ex : "Cimenteries du Maroc", taux 14 %), la regle est
-- memorisee automatiquement et appliquee aux futures transactions du meme
-- beneficiaire. L'override transaction par transaction reste toujours possible.
--
-- Migration deja appliquee en prod le 2026-09-02.

-- 1) Colonne taux sur bank_transactions (defaut 20 %, mais modifiable)
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS tva_rate numeric(5,2);

COMMENT ON COLUMN public.bank_transactions.tva_rate IS
  'Taux TVA applique (%). NULL = utiliser 20 par defaut (ou le taux memorise pour le beneficiaire). CEO 2026-09-02.';

-- 2) Table de memoire par beneficiaire
CREATE TABLE IF NOT EXISTS public.vendor_tva_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_normalized text NOT NULL UNIQUE,  -- lowercase + trimmed
  beneficiary_display text NOT NULL,             -- forme affichable originale
  tva_treatment tva_treatment_t NOT NULL DEFAULT 'auto',
  tva_rate numeric(5,2),                         -- NULL = pas de taux force
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT vendor_tva_rate_valid CHECK (tva_rate IS NULL OR (tva_rate >= 0 AND tva_rate <= 30))
);

CREATE INDEX IF NOT EXISTS vendor_tva_defaults_norm_idx
  ON public.vendor_tva_defaults (beneficiary_normalized);

COMMENT ON TABLE public.vendor_tva_defaults IS
  'Regles TVA memorisees par beneficiaire (auto-apprentissage). Appliquees quand bank_transactions.tva_treatment=auto. CEO 2026-09-02.';

-- 3) RLS : lecture CEO+finance+developer, ecriture CEO+finance
ALTER TABLE public.vendor_tva_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_tva_defaults_select ON public.vendor_tva_defaults;
CREATE POLICY vendor_tva_defaults_select ON public.vendor_tva_defaults
  FOR SELECT USING (current_user_role() = ANY (ARRAY['ceo','finance','developer']));

DROP POLICY IF EXISTS vendor_tva_defaults_write ON public.vendor_tva_defaults;
CREATE POLICY vendor_tva_defaults_write ON public.vendor_tva_defaults
  FOR ALL USING (current_user_role() = ANY (ARRAY['ceo','finance']))
  WITH CHECK (current_user_role() = ANY (ARRAY['ceo','finance']));
