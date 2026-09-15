-- ============================================================================
-- Fix : la vue propria_interventions_enriched utilise `i.*` qui est figé
-- à la création de la vue. Or la migration 20260528002000 a ajouté la
-- colonne `hostaway_integrated` à propria_interventions APRÈS la création
-- de la vue → la vue ignore la nouvelle colonne, et tout SELECT qui la
-- référence renvoie une erreur Supabase (→ liste vide côté front).
--
-- Solution : DROP + CREATE de la vue pour ré-expandre `i.*`.
-- ============================================================================

DROP VIEW IF EXISTS propria_interventions_enriched CASCADE;

CREATE VIEW propria_interventions_enriched AS
SELECT
  i.*,
  CASE
    WHEN i.client_billing_mad IS NOT NULL AND i.cost_propria_mad IS NOT NULL
    THEN i.client_billing_mad - i.cost_propria_mad
    ELSE NULL
  END AS marge_mad
FROM propria_interventions i
WHERE i.deleted_at IS NULL;

-- Re-applique security_invoker (perdu lors du DROP)
ALTER VIEW propria_interventions_enriched SET (security_invoker = on);

COMMENT ON VIEW propria_interventions_enriched IS
  'Vue enrichie des interventions Propria, expose la marge calculée + toutes les colonnes de la table source (i.*).';
