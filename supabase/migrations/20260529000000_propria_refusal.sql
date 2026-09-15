-- ============================================================================
-- Propria — Gestion du refus de mandat de gestion
-- ============================================================================
-- Au moment de la clôture projet (phase termine), le chef projet doit pouvoir
-- soit ACTIVER la gestion Propria, soit MARQUER LE REFUS du mandat (si le
-- client choisit une autre conciergerie ou loue en direct).
--
-- Sans ce marqueur, le bandeau "Activer Propria" continue de s'afficher
-- éternellement sur la fiche projet, ce qui pollue le tableau de bord.
--
-- Source de vérité après activation : équipe Propria (édition via
-- /propria/biens/[id]). Aucun trigger SQL freeze pour V1 — les routes
-- existantes empêchent déjà l'édition concurrente côté projet.
-- ============================================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS propria_refused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS propria_refused_reason TEXT;

COMMENT ON COLUMN properties.propria_refused_at IS
  'Date à laquelle le client a refusé le mandat de gestion Propria. NULL si pas refusé. Empêche le bandeau "Activer Propria" de se ré-afficher.';
COMMENT ON COLUMN properties.propria_refused_reason IS
  'Raison libre du refus (optionnel) : autre conciergerie, location directe, vente prévue, etc. Utile pour analyser le churn anti-Propria.';

-- Contrainte d'intégrité : un bien ne peut pas être à la fois géré ET refusé
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_propria_managed_or_refused;
ALTER TABLE properties
  ADD CONSTRAINT properties_propria_managed_or_refused CHECK (
    propria_managed_at IS NULL OR propria_refused_at IS NULL
  );
