-- ─── Incidents v2 (CEO 2026-06-09) ────────────────────────────────────
-- 1. Nouveau statut "declined" + raison
-- 2. Liaison 1:1 vers une intervention (linked_intervention_id côté incident,
--    source_cleaning_incident_id côté intervention)

ALTER TABLE public.propria_cleaning_incidents
  DROP CONSTRAINT IF EXISTS propria_cleaning_incidents_status_check;
ALTER TABLE public.propria_cleaning_incidents
  ADD CONSTRAINT propria_cleaning_incidents_status_check
  CHECK (status IN ('reported','acknowledged','resolved','declined'));

ALTER TABLE public.propria_cleaning_incidents
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decline_reason text;

ALTER TABLE public.propria_cleaning_incidents
  ADD COLUMN IF NOT EXISTS linked_intervention_id uuid
    REFERENCES public.propria_interventions(id) ON DELETE SET NULL;

ALTER TABLE public.propria_interventions
  ADD COLUMN IF NOT EXISTS source_cleaning_incident_id uuid
    REFERENCES public.propria_cleaning_incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cleaning_incidents_linked_intervention
  ON public.propria_cleaning_incidents(linked_intervention_id)
  WHERE linked_intervention_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interventions_source_incident
  ON public.propria_interventions(source_cleaning_incident_id)
  WHERE source_cleaning_incident_id IS NOT NULL;

COMMENT ON COLUMN public.propria_cleaning_incidents.declined_at IS
  'Horodatage du déclin de l''incident (CEO/back office a jugé non recevable). Mutuellement exclusif avec resolved_at.';
COMMENT ON COLUMN public.propria_cleaning_incidents.linked_intervention_id IS
  'Si l''incident a été transformé en intervention/tâche, FK vers propria_interventions. L''incident passe en status=resolved au moment de la transformation.';
COMMENT ON COLUMN public.propria_interventions.source_cleaning_incident_id IS
  'Si l''intervention a été créée à partir d''un incident ménage signalé, FK vers propria_cleaning_incidents. Utile pour navigation arrière et audit.';

NOTIFY pgrst, 'reload schema';
