-- ─── Push A : séparer interventions et tâches ──────────────────────────
-- CEO 2026-06-09 :
--   • intervention = action physique ET technique (plomberie, électricité,
--     réparation, ménage technique post-séjour)
--   • tache = action physique non technique (livraison de clés, dépôt de
--     consommable, changer les piles, dépôt d'équipement)
--
-- Tous les autres champs (coût, refacturation, assignation, validation)
-- restent identiques entre les deux types — une tâche peut aussi coûter
-- de l'argent (ex: achat de piles).

-- 1) Ajouter le champ kind avec défaut 'intervention' (rétrocompatible)
ALTER TABLE public.propria_interventions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'intervention';

-- 2) Contrainte d'intégrité : exactement les 2 valeurs autorisées
ALTER TABLE public.propria_interventions
  DROP CONSTRAINT IF EXISTS propria_interventions_kind_check;
ALTER TABLE public.propria_interventions
  ADD CONSTRAINT propria_interventions_kind_check
  CHECK (kind IN ('intervention', 'tache'));

-- 3) Index pour les filtres rapides sur /propria/interventions?kind=tache
CREATE INDEX IF NOT EXISTS idx_propria_interventions_kind
  ON public.propria_interventions(kind)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.propria_interventions.kind IS
  'Type de tâche Propria : "intervention" = action physique technique (plomberie, électricité, réparation, ménage technique) ; "tache" = action physique non technique (livraison clés, dépôt consommable, changer piles).';

-- 4) Vue enrichie : ré-expose kind à la FIN pour préserver l'ordre des
-- colonnes existantes (Postgres CREATE OR REPLACE VIEW exige cet ordre).
CREATE OR REPLACE VIEW public.propria_interventions_enriched AS
SELECT
  id,
  property_id,
  intervention_type_id,
  type_label,
  description,
  occurred_at,
  urgency,
  status,
  closed_at,
  responsable_id,
  provider_id,
  cost_propria_mad,
  client_billing_mad,
  charge_to,
  hostaway_ref,
  observations,
  deleted_at,
  created_by,
  created_at,
  updated_at,
  hostaway_integrated,
  propria_unit_id,
  assigned_to_id,
  due_date,
  submitted_at,
  validated_by,
  validated_at,
  refusal_reason,
  refused_at,
  refused_count,
  CASE
    WHEN client_billing_mad IS NOT NULL AND cost_propria_mad IS NOT NULL
      THEN client_billing_mad - cost_propria_mad
    ELSE NULL::numeric
  END AS marge_mad,
  due_date IS NOT NULL AND due_date < CURRENT_DATE
    AND (status <> ALL (ARRAY['cloture'::text, 'annule'::text])) AS is_overdue,
  status = 'a_valider'::text AS is_awaiting_validation,
  CASE
    WHEN validated_at IS NOT NULL AND submitted_at IS NOT NULL
      THEN EXTRACT(epoch FROM validated_at - submitted_at) / 86400.0
    ELSE NULL::numeric
  END AS validation_delay_days,
  kind   -- ⬅ Push A 2026-06-09
FROM public.propria_interventions i
WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
