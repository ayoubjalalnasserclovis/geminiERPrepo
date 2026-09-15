-- ============================================================================
-- Nettoyage : suppression de 5 tâches travaux qui ne sont plus pertinentes
-- ============================================================================
-- Ces tâches sont retirées :
--   - Verser acompte artisans (géré ailleurs via flow paiements artisans)
--   - Effectuer point d'avancement hebdomadaire (suivi déjà ailleurs)
--   - Envoyer photos chantier au client (process séparé)
--   - Réception intermédiaire chantier (suivi par jalons artisans)
--   - Verser solde artisans à la livraison (géré ailleurs via flow paiements)
-- ============================================================================
--
-- ⚠ Ordre des opérations :
--   1) Détache les tâches existantes du template (template_id = NULL)
--      → évite la violation FK tasks_template_id_fkey lors du DELETE des templates
--   2) Supprime les tâches non terminées (status != 'done') pour nettoyer les projets en cours
--   3) Supprime les templates (gabarits pour futurs projets)
--   4) Les tâches déjà completées sont conservées (template_id=NULL) pour l'historique

-- 1. Détache les tâches existantes du template avant de supprimer les templates
UPDATE tasks t
SET template_id = NULL
FROM task_templates tt
WHERE t.template_id = tt.id
  AND tt.phase = 'travaux'
  AND tt.title IN (
    'Verser acompte artisans (50% budget travaux)',
    'Effectuer point d''avancement hebdomadaire',
    'Envoyer photos chantier au client',
    'Réception intermédiaire chantier',
    'Verser solde artisans à la livraison'
  );

-- 2. Supprime les tâches NON terminées (les terminées restent pour l'historique)
DELETE FROM tasks
WHERE phase = 'travaux'
  AND status != 'done'
  AND title IN (
    'Verser acompte artisans (50% budget travaux)',
    'Effectuer point d''avancement hebdomadaire',
    'Envoyer photos chantier au client',
    'Réception intermédiaire chantier',
    'Verser solde artisans à la livraison'
  );

-- 3. Supprime les templates (plus aucune FK ne pointe dessus à ce stade)
DELETE FROM task_templates
WHERE phase = 'travaux'
  AND title IN (
    'Verser acompte artisans (50% budget travaux)',
    'Effectuer point d''avancement hebdomadaire',
    'Envoyer photos chantier au client',
    'Réception intermédiaire chantier',
    'Verser solde artisans à la livraison'
  );
