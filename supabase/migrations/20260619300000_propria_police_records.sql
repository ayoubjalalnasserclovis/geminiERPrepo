-- ============================================================================
-- Propria — Fiches de police voyageurs (V1)
-- ----------------------------------------------------------------------------
-- Décisions CEO 2026-06-19 :
--   * Périmètre : TOUS les voyageurs (Marocains inclus)
--   * Trigger : auto le jour du check-in (via cron daily-reminders, autre agent)
--   * Sources : portail Hostaway + saisie manuelle propria + WhatsApp
--   * Format : 1 PDF par famille + Excel récap hebdo
--   * Soumission : impression + dépôt physique commissariat (pas de télédéclar.)
--   * Enfants/accompagnants : 1 fiche par famille avec accompanying_persons jsonb
--   * Stockage : indéfini, suppression manuelle CEO (pas de purge auto)
--   * Accès : SELECT pour ceo/propria/assistante/developer
--            ; INSERT/UPDATE/DELETE pour ceo/propria/assistante (developer EXCLU)
--
-- Notes d'adaptation BDD prod (vs draft initial) :
--   * Table de réservations Hostaway = `hostaway_reservations` (pas
--     `propria_reservations` qui n'existe pas).
--   * Pas de `property_id` direct sur hostaway_reservations : on remonte via
--     hostaway_listings → propria_unit_id → propria_units.property_id.
--   * 2 autres tables de réservations manuelles existent :
--     `propria_direct_reservations` et `propria_cash_reservations`
--     → On ne référence aucune des 3 par FK forte (la table de référence diffère
--     selon la source). On garde donc reservation_source_table + reservation_source_id
--     en texte/uuid pour traçabilité, sans contrainte FK polymorphe.
--   * Fonction trigger réutilisée : public.set_updated_at() (vérifiée OK en prod).
--   * Pattern RLS aligné sur les autres migrations propria : helper
--     public.is_staff(ARRAY[...]) plutôt que sous-requête profiles.
-- ============================================================================

-- ---- Enums --------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE police_record_status AS ENUM ('draft', 'complete', 'submitted', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE police_record_id_type AS ENUM ('cin', 'passport', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE police_record_source AS ENUM ('hostaway_portal', 'manual_checkin', 'whatsapp', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE police_record_motif AS ENUM ('tourisme', 'affaires', 'famille', 'transit', 'autre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Table principale ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.propria_police_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Liens vers les entités Propria ; tous nullable pour supporter la saisie
  -- 100% manuelle ou les fiches détachées d'une résa supprimée.
  -- NB: pas de FK vers les 3 tables de réservations (polymorphisme par source) :
  --     on stocke (source, id) pour conserver la traçabilité.
  reservation_source text CHECK (reservation_source IN ('hostaway','direct','cash')) DEFAULT NULL,
  reservation_source_id uuid DEFAULT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  propria_unit_id uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,

  -- Chef de famille (1 fiche = 1 famille)
  head_last_name text NOT NULL DEFAULT '',
  head_first_name text NOT NULL DEFAULT '',
  head_gender text CHECK (head_gender IN ('M','F','autre')) DEFAULT NULL,
  head_birth_date date,
  head_birth_place text,
  head_nationality text,
  head_profession text,
  head_id_type police_record_id_type DEFAULT 'passport',
  head_id_number text,
  head_id_issue_date date,
  head_id_expiry_date date,
  head_id_issue_country text,
  head_residence_country text,
  head_residence_address text,

  -- Séjour
  arrival_date_morocco date,
  arrival_date_property date,
  expected_departure_date date,
  motif_sejour police_record_motif DEFAULT 'tourisme',

  -- Accompagnants (jsonb). Schéma :
  -- [{ last_name, first_name, birth_date, nationality, id_type, id_number, relation }]
  accompanying_persons jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Compteur dérivé : chef + accompagnants
  total_persons_count int GENERATED ALWAYS AS (
    1 + COALESCE(jsonb_array_length(accompanying_persons), 0)
  ) STORED,

  -- Workflow & source
  status police_record_status NOT NULL DEFAULT 'draft',
  data_source police_record_source NOT NULL DEFAULT 'unknown',
  notes text,

  -- Submission tracking
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Audit standard
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.propria_police_records IS
  'Fiches de police voyageurs Propria (V1). 1 fiche = 1 famille. Voir docs/propria/fiche-police-format.md';

-- ---- Indexes ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_propria_police_records_reservation
  ON public.propria_police_records(reservation_source, reservation_source_id)
  WHERE deleted_at IS NULL AND reservation_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_propria_police_records_arrival
  ON public.propria_police_records(arrival_date_property)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_propria_police_records_status
  ON public.propria_police_records(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_propria_police_records_property
  ON public.propria_police_records(property_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_propria_police_records_unit
  ON public.propria_police_records(propria_unit_id)
  WHERE deleted_at IS NULL;

-- 1 fiche max par (source, id) — évite les doublons côté cron
CREATE UNIQUE INDEX IF NOT EXISTS idx_propria_police_records_unique_per_reservation
  ON public.propria_police_records(reservation_source, reservation_source_id)
  WHERE deleted_at IS NULL
    AND reservation_source IS NOT NULL
    AND reservation_source_id IS NOT NULL;

-- ---- Trigger updated_at -------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_propria_police_records ON public.propria_police_records;
CREATE TRIGGER set_updated_at_propria_police_records
BEFORE UPDATE ON public.propria_police_records
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- RLS ----------------------------------------------------------------
ALTER TABLE public.propria_police_records ENABLE ROW LEVEL SECURITY;

-- Lecture : ceo + propria + assistante + developer
DROP POLICY IF EXISTS "staff read police records" ON public.propria_police_records;
CREATE POLICY "staff read police records"
  ON public.propria_police_records
  FOR SELECT
  USING (public.is_staff(ARRAY['ceo','propria','assistante','developer']));

-- Insert : ceo + propria + assistante (developer exclu)
DROP POLICY IF EXISTS "staff insert police records" ON public.propria_police_records;
CREATE POLICY "staff insert police records"
  ON public.propria_police_records
  FOR INSERT
  WITH CHECK (public.is_staff(ARRAY['ceo','propria','assistante']));

-- Update : idem insert
DROP POLICY IF EXISTS "staff update police records" ON public.propria_police_records;
CREATE POLICY "staff update police records"
  ON public.propria_police_records
  FOR UPDATE
  USING (public.is_staff(ARRAY['ceo','propria','assistante']))
  WITH CHECK (public.is_staff(ARRAY['ceo','propria','assistante']));

-- Delete : idem insert (suppression manuelle CEO/propria/assistante, soft-delete encouragé)
DROP POLICY IF EXISTS "staff delete police records" ON public.propria_police_records;
CREATE POLICY "staff delete police records"
  ON public.propria_police_records
  FOR DELETE
  USING (public.is_staff(ARRAY['ceo','propria','assistante']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.propria_police_records TO authenticated;
