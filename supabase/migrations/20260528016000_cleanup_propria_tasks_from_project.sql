-- ============================================================================
-- Nettoyage : suppression des tâches Propria/conciergerie depuis la fiche projet
-- ============================================================================
-- 4 tâches phase livraison + 4 tâches phase mise_en_location qui sont en réalité
-- du périmètre Propria. Elles dupliquaient le tracking et embrouillaient le
-- chef projet.
--
-- Raison du retrait, par tâche :
--   LIVRAISON :
--     - Relever compteurs eau/élec   : déjà couvert par PV + contrats Propria
--     - Prendre photos finales       : vit côté Propria (annonces)
--     - Transférer dossier à PROPRIA : remplacé par "Activer la gestion Propria"
--     - Notification livraison client: doublon avec l'email PV automatique
--   MISE_EN_LOCATION :
--     - Créer annonces Airbnb/Booking : purement Propria (/propria/listings)
--     - Intégrer dans Hostaway        : tracké via propria_interventions.hostaway_integrated
--     - Contrat gestion PROPRIA       : tracké via properties.propria_mandate_start
--     - Notifier premier listing      : action Propria
--
-- Pattern aligné sur 20260528008000_cleanup_travaux_tasks.sql :
--   1) Détacher tasks existantes du template (template_id = NULL) pour éviter FK violation
--   2) Supprimer tasks NON terminées (les terminées restent en historique)
--   3) Supprimer les templates
-- ============================================================================

-- Tableau des paires (phase, title) à supprimer
WITH targets AS (
  SELECT * FROM (VALUES
    ('livraison'::project_phase,        'Relever compteurs eau et électricité'),
    ('livraison'::project_phase,        'Prendre les photos finales du bien'),
    ('livraison'::project_phase,        'Transférer le dossier à PROPRIA'),
    ('livraison'::project_phase,        'Envoyer notification de livraison au client'),
    ('mise_en_location'::project_phase, 'Créer les annonces Airbnb / Booking'),
    ('mise_en_location'::project_phase, 'Intégrer le bien dans Hostaway'),
    ('mise_en_location'::project_phase, 'Faire signer le contrat de gestion PROPRIA'),
    ('mise_en_location'::project_phase, 'Notifier le client du premier listing en ligne')
  ) AS t(phase, title)
)

-- 1. Détache les tâches existantes du template avant DELETE templates (FK)
UPDATE tasks t
SET template_id = NULL
FROM task_templates tt, targets g
WHERE t.template_id = tt.id
  AND tt.phase = g.phase
  AND tt.title = g.title;

-- 2. Supprime les tâches NON terminées (les "done" restent pour l'historique)
DELETE FROM tasks
WHERE status <> 'done'
  AND (phase, title) IN (
    ('livraison'::project_phase,        'Relever compteurs eau et électricité'),
    ('livraison'::project_phase,        'Prendre les photos finales du bien'),
    ('livraison'::project_phase,        'Transférer le dossier à PROPRIA'),
    ('livraison'::project_phase,        'Envoyer notification de livraison au client'),
    ('mise_en_location'::project_phase, 'Créer les annonces Airbnb / Booking'),
    ('mise_en_location'::project_phase, 'Intégrer le bien dans Hostaway'),
    ('mise_en_location'::project_phase, 'Faire signer le contrat de gestion PROPRIA'),
    ('mise_en_location'::project_phase, 'Notifier le client du premier listing en ligne')
  );

-- 3. Supprime les templates (FK désormais détachées)
DELETE FROM task_templates
WHERE (phase, title) IN (
  ('livraison'::project_phase,        'Relever compteurs eau et électricité'),
  ('livraison'::project_phase,        'Prendre les photos finales du bien'),
  ('livraison'::project_phase,        'Transférer le dossier à PROPRIA'),
  ('livraison'::project_phase,        'Envoyer notification de livraison au client'),
  ('mise_en_location'::project_phase, 'Créer les annonces Airbnb / Booking'),
  ('mise_en_location'::project_phase, 'Intégrer le bien dans Hostaway'),
  ('mise_en_location'::project_phase, 'Faire signer le contrat de gestion PROPRIA'),
  ('mise_en_location'::project_phase, 'Notifier le client du premier listing en ligne')
);
