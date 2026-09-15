-- ─── Chantier 9 marathon (consultant sujet 2 + décision CEO B6) — Upsell ────
--
-- Module Upsell + QR codes :
--  1. propria_upsells : commandes de services additionnels (transfert,
--     petit-déjeuner, activité, early check-in, late check-out, autre).
--     Deux sources : 'interne' (saisie bureau) et 'qr' (commande voyageur via
--     la page publique /upsell/<slug>, SANS paiement en ligne — décision B6).
--     Tout en MAD (opérationnel). CA TOUJOURS dérivé (somme des lignes
--     confirme+livre côté lecture) — convention n°1, aucun total stocké.
--  2. propria_units.upsell_slug : slug public non-devinable par lot, imprimé
--     en QR code sur support bois dans le logement. DEFAULT aléatoire pour
--     les futurs lots + backfill des lots existants.
--
-- Idempotent : IF NOT EXISTS / DROP POLICY IF EXISTS partout, re-run sans effet.

-- ─── 1) Table propria_upsells ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.propria_upsells (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propria_unit_id         uuid NOT NULL REFERENCES public.propria_units(id) ON DELETE CASCADE,
  -- hostaway_reservations.hostaway_id (bigint) — nullable : une commande QR
  -- peut arriver sans résa identifiée (le voyageur saisit un code en texte libre).
  hostaway_reservation_id bigint,
  guest_name              text,
  guest_contact           text,          -- téléphone / WhatsApp saisi par le voyageur
  category                text NOT NULL CHECK (category IN (
    'transfert','petit_dejeuner','activite','early_checkin','late_checkout','autre'
  )),
  description             text,
  -- 0 par défaut pour les commandes QR : le bureau chiffre après contact.
  amount_mad              numeric NOT NULL DEFAULT 0 CHECK (amount_mad >= 0),
  status                  text NOT NULL DEFAULT 'commande' CHECK (status IN (
    'commande','confirme','livre','annule'
  )),
  source                  text NOT NULL DEFAULT 'interne' CHECK (source IN ('interne','qr')),
  -- Tâche back-office créée automatiquement pour les commandes QR.
  linked_intervention_id  uuid REFERENCES public.propria_interventions(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_propria_upsells_unit
  ON public.propria_upsells(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_upsells_reservation
  ON public.propria_upsells(hostaway_reservation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_upsells_category
  ON public.propria_upsells(category) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_upsells_updated_at ON public.propria_upsells;
CREATE TRIGGER propria_upsells_updated_at
  BEFORE UPDATE ON public.propria_upsells
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.propria_upsells IS
  'Commandes upsell Propria (chantier 9 marathon, décision B6). Source interne (bureau) ou qr (page publique /upsell/<slug>). Montants en MAD, CA dérivé à la lecture (statuts confirme+livre) — jamais stocké. Soft-delete uniquement.';
COMMENT ON COLUMN public.propria_upsells.hostaway_reservation_id IS
  'hostaway_reservations.hostaway_id (bigint Hostaway). Nullable : commande QR sans résa identifiée.';
COMMENT ON COLUMN public.propria_upsells.amount_mad IS
  'Prix du service en MAD. 0 à la création QR — le bureau chiffre après contact voyageur.';

-- RLS : lecture staff, écriture ceo+assistante+propria, delete CEO.
-- AUCUN accès anon : la commande publique passe par le serveur (service_role).
ALTER TABLE public.propria_upsells ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read upsells"  ON public.propria_upsells;
DROP POLICY IF EXISTS "ops insert upsells"  ON public.propria_upsells;
DROP POLICY IF EXISTS "ops update upsells"  ON public.propria_upsells;
DROP POLICY IF EXISTS "ceo delete upsells"  ON public.propria_upsells;
CREATE POLICY "staff read upsells" ON public.propria_upsells
  FOR SELECT USING (public.is_staff());
CREATE POLICY "ops insert upsells" ON public.propria_upsells
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ops update upsells" ON public.propria_upsells
  FOR UPDATE USING (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ceo delete upsells" ON public.propria_upsells
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

-- ─── 2) Slug public par lot (QR code) ────────────────────────────────────
-- DEFAULT volatile : chaque futur lot reçoit son propre slug aléatoire
-- (18 hex = 72 bits, non-devinable). pgcrypto déjà activé (migration 00).
ALTER TABLE public.propria_units
  ADD COLUMN IF NOT EXISTS upsell_slug text DEFAULT encode(gen_random_bytes(9), 'hex');

-- Backfill idempotent des lots existants (et filet de sécurité si la colonne
-- existait déjà avec des NULL).
UPDATE public.propria_units
  SET upsell_slug = encode(gen_random_bytes(9), 'hex')
  WHERE upsell_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS propria_units_upsell_slug_key
  ON public.propria_units(upsell_slug);

COMMENT ON COLUMN public.propria_units.upsell_slug IS
  'Slug public non-devinable de la page upsell voyageur (/upsell/<slug>), imprimé en QR code dans le logement. Généré automatiquement (chantier 9 marathon).';

NOTIFY pgrst, 'reload schema';
