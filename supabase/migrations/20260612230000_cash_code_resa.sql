-- ─── Chantier 14 marathon (consultant U13 + sujet 1, décision CEO A3) ──────
--
-- Réservations cash + code résa propagé partout :
--
--  1. propria_direct_reservations : résas directes HORS OTA, auto-remontée
--     interne (décision A3 — Hostaway reste unidirectionnel, on ne pousse
--     rien vers Hostaway). Code résa lisible généré : 'DIR-XXXXXX'.
--     Reste à encaisser = TOUJOURS DÉRIVÉ (total_price_mad − collected_mad),
--     jamais stocké — convention n°1. collected_mad est une SOURCE (cumul
--     des encaissements saisis par le terrain).
--
--  2. propria_transfers.hostaway_ref : propagation du code résa au module
--     transferts (aligné sur propria_interventions.hostaway_ref qui existe
--     depuis les fondations).
--
-- Idempotent : IF NOT EXISTS / DROP POLICY IF EXISTS partout, re-run sans effet.
-- Soft-delete only (deleted_at). RLS strict : lecture staff, écriture
-- ceo/assistante/propria, delete CEO (cash sensible → pilotage CEO).

-- ─── 1) Table propria_direct_reservations ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.propria_direct_reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propria_unit_id  uuid NOT NULL REFERENCES public.propria_units(id) ON DELETE CASCADE,
  guest_name       text NOT NULL,
  guest_contact    text,
  arrival_date     date NOT NULL,
  departure_date   date NOT NULL,
  total_price_mad  numeric NOT NULL CHECK (total_price_mad >= 0),
  -- Cumul des encaissements (source saisie). Reste à encaisser = dérivé.
  collected_mad    numeric NOT NULL DEFAULT 0 CHECK (collected_mad >= 0),
  -- Code résa lisible non-devinable : DIR- + 6 hex majuscules (pgcrypto
  -- déjà activé — même mécanisme que propria_units.upsell_slug).
  reservation_code text UNIQUE NOT NULL DEFAULT ('DIR-' || upper(encode(gen_random_bytes(3), 'hex'))),
  notes            text,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT propria_direct_reservations_dates_check
    CHECK (departure_date > arrival_date)
);

CREATE INDEX IF NOT EXISTS idx_propria_direct_reservations_unit
  ON public.propria_direct_reservations(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_direct_reservations_arrival
  ON public.propria_direct_reservations(arrival_date DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_direct_reservations_updated_at ON public.propria_direct_reservations;
CREATE TRIGGER propria_direct_reservations_updated_at
  BEFORE UPDATE ON public.propria_direct_reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.propria_direct_reservations IS
  'Résas directes hors OTA (chantier 14 marathon, décision A3 : auto-remontée interne, Hostaway unidirectionnel). Reste à encaisser DÉRIVÉ = total_price_mad − collected_mad, jamais stocké. Soft-delete uniquement.';
COMMENT ON COLUMN public.propria_direct_reservations.collected_mad IS
  'Cumul des montants encaissés sur cette résa (source saisie terrain). Le reste à encaisser est dérivé à la lecture.';
COMMENT ON COLUMN public.propria_direct_reservations.reservation_code IS
  'Code résa lisible DIR-XXXXXX, propagé dans les tâches de collecte (propria_interventions.hostaway_ref) et affiché partout.';

-- RLS : lecture staff, écriture ceo+assistante+propria, delete CEO.
ALTER TABLE public.propria_direct_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read direct_reservations" ON public.propria_direct_reservations;
DROP POLICY IF EXISTS "ops insert direct_reservations" ON public.propria_direct_reservations;
DROP POLICY IF EXISTS "ops update direct_reservations" ON public.propria_direct_reservations;
DROP POLICY IF EXISTS "ceo delete direct_reservations" ON public.propria_direct_reservations;
CREATE POLICY "staff read direct_reservations" ON public.propria_direct_reservations
  FOR SELECT USING (public.is_staff());
CREATE POLICY "ops insert direct_reservations" ON public.propria_direct_reservations
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ops update direct_reservations" ON public.propria_direct_reservations
  FOR UPDATE USING (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ceo delete direct_reservations" ON public.propria_direct_reservations
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

-- ─── 2) Propagation code résa : transferts ───────────────────────────────
ALTER TABLE public.propria_transfers
  ADD COLUMN IF NOT EXISTS hostaway_ref text;

COMMENT ON COLUMN public.propria_transfers.hostaway_ref IS
  'Code de la réservation liée (hostaway_reservations.hostaway_id ou code DIR- d''une résa directe). Propagation chantier 14.';

NOTIFY pgrst, 'reload schema';
