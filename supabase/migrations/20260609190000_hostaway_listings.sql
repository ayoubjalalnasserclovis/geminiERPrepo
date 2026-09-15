-- ─── Intégration Hostaway — étape 3 (CEO 2026-06-09) ──────────────────
-- Table mirroir des listings Hostaway, avec lien optionnel vers
-- propria_units (matching CEO).

CREATE TABLE IF NOT EXISTS public.hostaway_listings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostaway_id          bigint NOT NULL UNIQUE,
  name                 text,
  address              text,
  external_listing_id  text,
  is_active            boolean NOT NULL DEFAULT true,
  propria_unit_id      uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,
  matched_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  matched_at           timestamptz,
  raw_data             jsonb,
  last_synced_at       timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hostaway_listings_unit
  ON public.hostaway_listings(propria_unit_id)
  WHERE propria_unit_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_listings_unmatched
  ON public.hostaway_listings(id)
  WHERE propria_unit_id IS NULL AND deleted_at IS NULL;

COMMENT ON TABLE public.hostaway_listings IS
  'Miroir des listings Hostaway. Synchronisé via /api/admin/hostaway/sync-listings. propria_unit_id permet le matching avec une suite Stoniz.';

ALTER TABLE public.hostaway_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read hostaway_listings"   ON public.hostaway_listings;
DROP POLICY IF EXISTS "staff insert hostaway_listings" ON public.hostaway_listings;
DROP POLICY IF EXISTS "staff update hostaway_listings" ON public.hostaway_listings;
DROP POLICY IF EXISTS "staff delete hostaway_listings" ON public.hostaway_listings;
CREATE POLICY "staff read hostaway_listings"   ON public.hostaway_listings FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert hostaway_listings" ON public.hostaway_listings FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update hostaway_listings" ON public.hostaway_listings FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete hostaway_listings" ON public.hostaway_listings FOR DELETE USING (public.is_staff());

NOTIFY pgrst, 'reload schema';
