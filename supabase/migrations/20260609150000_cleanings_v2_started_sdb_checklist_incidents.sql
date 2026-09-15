-- ─── Ménage v2 (CEO 2026-06-09) ───────────────────────────────────────
-- 5 chantiers en une migration :
--   1. started_at = heure du clic « Démarrer »
--   2. propria_nb_sdb sur la suite
--   3. checklist multi-photos par item
--   4. section sur les preuves (general/checklist/equipment/incident)
--   5. table incidents avec alerte CEO

ALTER TABLE public.propria_cleanings
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.propria_interventions
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE public.propria_units
  ADD COLUMN IF NOT EXISTS propria_nb_sdb integer CHECK (propria_nb_sdb IS NULL OR propria_nb_sdb >= 0);

ALTER TABLE public.propria_cleaning_proofs
  ADD COLUMN IF NOT EXISTS checklist_item_key text,
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'general';

ALTER TABLE public.propria_cleaning_proofs
  DROP CONSTRAINT IF EXISTS propria_cleaning_proofs_section_check;
ALTER TABLE public.propria_cleaning_proofs
  ADD CONSTRAINT propria_cleaning_proofs_section_check
  CHECK (section IN ('general','checklist','equipment','incident'));

CREATE INDEX IF NOT EXISTS idx_propria_cleaning_proofs_item
  ON public.propria_cleaning_proofs(cleaning_id, checklist_item_key)
  WHERE deleted_at IS NULL AND checklist_item_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.propria_cleaning_incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_id     uuid NOT NULL REFERENCES public.propria_cleanings(id) ON DELETE CASCADE,
  description     text NOT NULL,
  severity        text NOT NULL DEFAULT 'normale'
    CHECK (severity IN ('critique','haute','normale','basse')),
  status          text NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported','acknowledged','resolved')),
  reported_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reported_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  resolution_notes text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propria_cleaning_incidents_clean
  ON public.propria_cleaning_incidents(cleaning_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_cleaning_incidents_status
  ON public.propria_cleaning_incidents(status, reported_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_cleaning_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read incidents"   ON public.propria_cleaning_incidents;
DROP POLICY IF EXISTS "staff insert incidents" ON public.propria_cleaning_incidents;
DROP POLICY IF EXISTS "staff update incidents" ON public.propria_cleaning_incidents;
DROP POLICY IF EXISTS "staff delete incidents" ON public.propria_cleaning_incidents;
CREATE POLICY "staff read incidents"   ON public.propria_cleaning_incidents FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert incidents" ON public.propria_cleaning_incidents FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update incidents" ON public.propria_cleaning_incidents FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete incidents" ON public.propria_cleaning_incidents FOR DELETE USING (public.is_staff());

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
    WHEN submitted_at IS NOT NULL
      THEN EXTRACT(epoch FROM submitted_at - COALESCE(started_at, created_at)) / 3600.0
    ELSE NULL::numeric
  END AS realisation_hours,
  started_at
FROM public.propria_cleanings c
WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
