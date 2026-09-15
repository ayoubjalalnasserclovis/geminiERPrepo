-- ─── Module ménage Propria (CEO 2026-06-09) ───────────────────────────
-- Module séparé des interventions/tâches. Workflow identique
-- (a_traiter → en_cours → a_valider → cloture) mais dégraissé :
--   • Pas de coût (dames de ménage salariées)
--   • Pas de provider externe
--   • Pas de Hostaway / hostaway_integrated
--   • Pas de marge / refacturation client
--   • Pas de paid_from_wallet_id

CREATE TABLE IF NOT EXISTS public.propria_cleaning_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.propria_cleaning_types (name, display_order, is_active)
VALUES
  ('Ménage voyageur',      10, true),
  ('Ménage propriétaire',  20, true),
  ('Premier ménage',       30, true),
  ('Gros ménage',          40, true),
  ('Poussière',            50, true)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.propria_cleanings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  propria_unit_id   uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,
  cleaning_type_id  uuid REFERENCES public.propria_cleaning_types(id) ON DELETE SET NULL,
  description       text,
  occurred_at       date NOT NULL DEFAULT CURRENT_DATE,
  due_date          date,
  urgency           text NOT NULL DEFAULT 'normale'
    CHECK (urgency IN ('critique','haute','normale','basse')),
  status            text NOT NULL DEFAULT 'a_traiter'
    CHECK (status IN ('a_traiter','en_cours','a_valider','cloture','refusee','annule')),
  assigned_to_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  responsable_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  observations      text,
  submitted_at      timestamptz,
  validated_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  validated_at      timestamptz,
  closed_at         timestamptz,
  refusal_reason    text,
  refused_at        timestamptz,
  refused_count     integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_propria_cleanings_status
  ON public.propria_cleanings(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_cleanings_assigned
  ON public.propria_cleanings(assigned_to_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_cleanings_property
  ON public.propria_cleanings(property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_cleanings_unit
  ON public.propria_cleanings(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_cleanings_unassigned
  ON public.propria_cleanings(occurred_at DESC)
  WHERE deleted_at IS NULL AND assigned_to_id IS NULL
    AND status NOT IN ('cloture','annule');

CREATE TABLE IF NOT EXISTS public.propria_cleaning_proofs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_id     uuid NOT NULL REFERENCES public.propria_cleanings(id) ON DELETE CASCADE,
  storage_path    text NOT NULL,
  mime_type       text,
  size_bytes      integer,
  uploaded_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_propria_cleaning_proofs_clean
  ON public.propria_cleaning_proofs(cleaning_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.propria_cleaning_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_id   uuid NOT NULL REFERENCES public.propria_cleanings(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action IN (
    'created','edited','status_changed','assigned','unassigned',
    'submitted','validated','refused','cancelled','reopened'
  )),
  payload       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propria_cleaning_activity_clean
  ON public.propria_cleaning_activity(cleaning_id, created_at DESC);

CREATE OR REPLACE VIEW public.propria_cleanings_enriched AS
SELECT
  id, property_id, propria_unit_id, cleaning_type_id, description,
  occurred_at, due_date, urgency, status, closed_at,
  assigned_to_id, responsable_id, observations,
  submitted_at, validated_by, validated_at,
  refusal_reason, refused_at, refused_count,
  deleted_at, created_by, created_at, updated_at,
  (due_date IS NOT NULL AND due_date < CURRENT_DATE
    AND status NOT IN ('cloture','annule')) AS is_overdue,
  (status = 'a_valider') AS is_awaiting_validation,
  CASE
    WHEN validated_at IS NOT NULL AND submitted_at IS NOT NULL
      THEN EXTRACT(epoch FROM validated_at - submitted_at) / 86400.0
    ELSE NULL::numeric
  END AS validation_delay_days,
  CASE
    WHEN submitted_at IS NOT NULL AND created_at IS NOT NULL
      THEN EXTRACT(epoch FROM submitted_at - created_at) / 3600.0
    ELSE NULL::numeric
  END AS realisation_hours
FROM public.propria_cleanings c
WHERE deleted_at IS NULL;

ALTER TABLE public.propria_cleaning_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propria_cleanings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propria_cleaning_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propria_cleaning_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read types"   ON public.propria_cleaning_types;
DROP POLICY IF EXISTS "staff write types"  ON public.propria_cleaning_types;
DROP POLICY IF EXISTS "staff update types" ON public.propria_cleaning_types;
CREATE POLICY "staff read types"   ON public.propria_cleaning_types FOR SELECT USING (public.is_staff());
CREATE POLICY "staff write types"  ON public.propria_cleaning_types FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update types" ON public.propria_cleaning_types FOR UPDATE USING (public.is_staff());

DROP POLICY IF EXISTS "staff read cleanings"   ON public.propria_cleanings;
DROP POLICY IF EXISTS "staff insert cleanings" ON public.propria_cleanings;
DROP POLICY IF EXISTS "staff update cleanings" ON public.propria_cleanings;
DROP POLICY IF EXISTS "staff delete cleanings" ON public.propria_cleanings;
CREATE POLICY "staff read cleanings"   ON public.propria_cleanings FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert cleanings" ON public.propria_cleanings FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update cleanings" ON public.propria_cleanings FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete cleanings" ON public.propria_cleanings FOR DELETE USING (public.is_staff());

DROP POLICY IF EXISTS "staff read proofs"   ON public.propria_cleaning_proofs;
DROP POLICY IF EXISTS "staff insert proofs" ON public.propria_cleaning_proofs;
DROP POLICY IF EXISTS "staff update proofs" ON public.propria_cleaning_proofs;
DROP POLICY IF EXISTS "staff delete proofs" ON public.propria_cleaning_proofs;
CREATE POLICY "staff read proofs"   ON public.propria_cleaning_proofs FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert proofs" ON public.propria_cleaning_proofs FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update proofs" ON public.propria_cleaning_proofs FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete proofs" ON public.propria_cleaning_proofs FOR DELETE USING (public.is_staff());

DROP POLICY IF EXISTS "staff read activity"   ON public.propria_cleaning_activity;
DROP POLICY IF EXISTS "staff insert activity" ON public.propria_cleaning_activity;
CREATE POLICY "staff read activity"   ON public.propria_cleaning_activity FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert activity" ON public.propria_cleaning_activity FOR INSERT WITH CHECK (public.is_staff());

COMMENT ON TABLE public.propria_cleanings IS
  'Tâches de ménage assignées au personnel (salarié, hors flux caisse). Workflow identique aux interventions mais dégraissé (pas de coût, pas de provider externe, pas de Hostaway, pas de refacturation).';
COMMENT ON COLUMN public.propria_cleanings.submitted_at IS
  'Heure réelle de fin terrain : instant où la dame de ménage soumet ses preuves pour validation.';

NOTIFY pgrst, 'reload schema';
