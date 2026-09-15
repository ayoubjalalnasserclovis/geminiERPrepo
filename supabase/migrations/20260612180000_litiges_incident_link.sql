-- ─── Chantier 8 marathon (U8) — Incidents : transformation multi-cible ──────
--
-- Un incident ménage peut désormais être transformé en LITIGE (en plus de
-- tâche/intervention), et en PLUSIEURS actions simultanément (ex : TV cassée
-- → tâche d'achat + intervention d'installation + litige AirCover).
--
-- Modèle : liens INVERSES (l'objet créé pointe vers son incident source),
-- comme propria_interventions.source_cleaning_incident_id existant.
-- L'ancien lien direct propria_cleaning_incidents.linked_intervention_id est
-- conservé (rétro-compat) mais n'est plus la source de vérité pour l'affichage.
--
-- Décision M5 (DECISIONS-MARATHON.md) : un litige reste rattaché à une résa
-- (hostaway_reservation_id NOT NULL inchangé). La transformation en litige
-- n'est proposée que si le ménage source est lié à une réservation Hostaway.
--
-- Idempotent.

ALTER TABLE public.propria_litiges
  ADD COLUMN IF NOT EXISTS source_cleaning_incident_id uuid
    REFERENCES public.propria_cleaning_incidents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.propria_litiges.source_cleaning_incident_id IS
  'Incident ménage à l''origine du litige (transformation chantier 8 marathon). NULL si litige créé manuellement.';

CREATE INDEX IF NOT EXISTS idx_litiges_source_incident
  ON public.propria_litiges(source_cleaning_incident_id)
  WHERE source_cleaning_incident_id IS NOT NULL AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
