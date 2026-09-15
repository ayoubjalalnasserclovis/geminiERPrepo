-- Étendre partners pour distinguer agence/particulier/notaire et tracker les
-- exigences par type (CEO 2026-06-24).
-- Référence Phase B1 : module complétude (/admin/completude).

-- 1. partner_type
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS partner_type text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partners_partner_type_check'
  ) THEN
    ALTER TABLE public.partners ADD CONSTRAINT partners_partner_type_check
      CHECK (partner_type IS NULL OR partner_type IN ('agence', 'particulier', 'notaire', 'avocat', 'autre'));
  END IF;
END$$;

-- 2. ICE/RC/IF/patente (optionnels selon le type)
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS ice text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS rc text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS if_number text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS patente text;

-- 3. Bancaire
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS rib text;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS bank_account_holder text;

-- 4. Commission rate (0-100 %)
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS commission_rate_pct numeric(5,2);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partners_commission_rate_check'
  ) THEN
    ALTER TABLE public.partners ADD CONSTRAINT partners_commission_rate_check
      CHECK (commission_rate_pct IS NULL OR (commission_rate_pct >= 0 AND commission_rate_pct <= 100));
  END IF;
END$$;

-- 5. Doc contrat : on réutilise vendor_documents.partner_id (déjà présent).
-- Pas de changement de schéma. Documenté dans le helper.

COMMENT ON COLUMN public.partners.partner_type IS 'agence | particulier | notaire | avocat | autre — pilote les exigences de complétude';
COMMENT ON COLUMN public.partners.commission_rate_pct IS 'Taux de commission par défaut en %, 0-100';

NOTIFY pgrst, 'reload schema';
