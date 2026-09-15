-- ─── Intégration Hostaway — étape 4 : réservations ────────────────────
-- CEO 2026-06-09 : table miroir des réservations Hostaway. Sert de base
-- pour la création auto des ménages voyageurs (étape 5) à chaque check-out.

CREATE TABLE IF NOT EXISTS public.hostaway_reservations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostaway_id             bigint NOT NULL UNIQUE,
  hostaway_listing_id     bigint NOT NULL,
  hostaway_listing_db_id  uuid REFERENCES public.hostaway_listings(id) ON DELETE SET NULL,
  guest_name              text,
  guest_email             text,
  guest_phone             text,
  number_of_guests        integer,
  arrival_date            date NOT NULL,
  departure_date          date NOT NULL,
  check_in_time           text,
  check_out_time          text,
  nights                  integer,
  status                  text,
  channel_id              bigint,
  channel_name            text,
  total_price             numeric,
  currency                text,
  guest_note              text,
  raw_data                jsonb,
  last_synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hostaway_reservations_arrival
  ON public.hostaway_reservations(arrival_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reservations_departure
  ON public.hostaway_reservations(departure_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reservations_listing_db
  ON public.hostaway_reservations(hostaway_listing_db_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostaway_reservations_status
  ON public.hostaway_reservations(status) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.hostaway_reservations IS
  'Réservations Hostaway synchronisées (futures + 7 derniers jours). Base pour la création auto des ménages voyageurs à chaque check-out (étape 5).';

ALTER TABLE public.hostaway_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read hostaway_reservations"   ON public.hostaway_reservations;
DROP POLICY IF EXISTS "staff insert hostaway_reservations" ON public.hostaway_reservations;
DROP POLICY IF EXISTS "staff update hostaway_reservations" ON public.hostaway_reservations;
DROP POLICY IF EXISTS "staff delete hostaway_reservations" ON public.hostaway_reservations;
CREATE POLICY "staff read hostaway_reservations"   ON public.hostaway_reservations FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert hostaway_reservations" ON public.hostaway_reservations FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update hostaway_reservations" ON public.hostaway_reservations FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete hostaway_reservations" ON public.hostaway_reservations FOR DELETE USING (public.is_staff());

NOTIFY pgrst, 'reload schema';
