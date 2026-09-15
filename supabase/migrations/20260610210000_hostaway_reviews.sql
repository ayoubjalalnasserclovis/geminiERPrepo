-- ─── Intégration Hostaway — étape 6 : avis voyageurs ─────────────────
-- CEO 2026-06-10 : remontée des avis voyageurs cross-canal (Airbnb, Booking,
-- Direct…) avec workflow interne et suivi de la suppression (cas
-- contestation Airbnb/Booking où un avis négatif est retiré).
--
-- Why : suivre les avis non-5/5 pour réagir (relance voyageur, contestation
-- Airbnb, action corrective sur la suite) + mesurer la qualité de service
-- par suite et par canal.

CREATE TABLE IF NOT EXISTS public.hostaway_reviews (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostaway_id             bigint NOT NULL UNIQUE,
  type                    text,              -- 'guest-to-host' | 'host-to-guest'
  channel_name            text,              -- airbnb, booking, direct…
  hostaway_listing_id     bigint,
  hostaway_listing_db_id  uuid REFERENCES public.hostaway_listings(id) ON DELETE SET NULL,
  propria_unit_id         uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,
  hostaway_reservation_id bigint,
  guest_name              text,
  public_review           text,              -- commentaire public
  private_review          text,              -- commentaire privé (rare)
  rating                  numeric,           -- valeur brute (Airbnb 1-5, Booking 1-10)
  rating_normalized       numeric,           -- toujours sur 5 — pour comparaisons cross-canal
  category_ratings        jsonb,             -- {cleanliness: 5, communication: 4, …}
  response_from_host      text,
  response_date           timestamptz,
  submitted_at            timestamptz NOT NULL,
  is_published            boolean DEFAULT true,
  removed_at              timestamptz,       -- posé si l'avis disparaît d'une sync suivante
  -- Workflow interne équipe Propria
  internal_status         text NOT NULL DEFAULT 'to_review' CHECK (internal_status IN ('to_review','reviewed','resolved')),
  internal_notes          text,
  internal_handled_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  internal_handled_at     timestamptz,
  raw_data                jsonb,
  last_synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_unit_submitted
  ON public.hostaway_reviews(propria_unit_id, submitted_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_rating
  ON public.hostaway_reviews(rating_normalized) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_submitted
  ON public.hostaway_reviews(submitted_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_status
  ON public.hostaway_reviews(internal_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_removed
  ON public.hostaway_reviews(removed_at) WHERE removed_at IS NOT NULL;

COMMENT ON TABLE public.hostaway_reviews IS
  'Avis voyageurs synchronisés depuis Hostaway. Filtres métier sur rating_normalized (toujours /5). internal_status pour le workflow équipe Propria. removed_at posé quand un avis disparaît de la sync suivante.';

ALTER TABLE public.hostaway_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read hostaway_reviews"   ON public.hostaway_reviews;
DROP POLICY IF EXISTS "staff insert hostaway_reviews" ON public.hostaway_reviews;
DROP POLICY IF EXISTS "staff update hostaway_reviews" ON public.hostaway_reviews;
DROP POLICY IF EXISTS "staff delete hostaway_reviews" ON public.hostaway_reviews;
CREATE POLICY "staff read hostaway_reviews"   ON public.hostaway_reviews FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert hostaway_reviews" ON public.hostaway_reviews FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update hostaway_reviews" ON public.hostaway_reviews FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete hostaway_reviews" ON public.hostaway_reviews FOR DELETE USING (public.is_staff());

NOTIFY pgrst, 'reload schema';
