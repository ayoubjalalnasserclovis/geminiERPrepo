-- ============================================================================
-- Tâches auto en phase Livraison — workflow réception
-- ============================================================================
-- Ajoute dans les templates les tâches du module Réception (VCT + PV) pour
-- qu'elles soient auto-générées à l'entrée en phase Livraison.
--
-- Workflow chronologique en phase Livraison :
--   5  - Faire la VCT (bloquant)
--   10 - Remise des clés au client (bloquant)       [existant]
--   12 - Créer le PV de réception (bloquant)
--   15 - Envoyer le PV au client (bloquant)
--   17 - Récupérer signature client du PV (bloquant)
--   20 - Relever compteurs eau/élec (bloquant)      [existant]
--   25 - Activer la gestion Propria (non bloquant)
--   30 - Photos finales (non bloquant)              [existant]
--   40 - Transférer dossier PROPRIA (non bloquant)  [existant]
--   50 - Envoyer notification livraison (non bloquant) [existant]
-- ============================================================================

-- Insertions idempotentes : si le titre existe déjà sur la phase, on ne re-insère pas
INSERT INTO task_templates (phase, title, default_assigned_role, order_index, is_blocking)
SELECT * FROM (VALUES
  ('livraison'::project_phase, 'Faire la Visite Contrôle Technique (VCT)',           'chef_projet', 5,  true),
  ('livraison'::project_phase, 'Créer le PV de réception',                           'chef_projet', 12, true),
  ('livraison'::project_phase, 'Envoyer le PV de réception au client',               'chef_projet', 15, true),
  ('livraison'::project_phase, 'Récupérer la signature électronique du PV client',   'chef_projet', 17, true),
  ('livraison'::project_phase, 'Activer la gestion Propria',                         'chef_projet', 25, false)
) AS t(phase, title, default_assigned_role, order_index, is_blocking)
WHERE NOT EXISTS (
  SELECT 1 FROM task_templates
  WHERE task_templates.phase = t.phase AND task_templates.title = t.title
);

COMMENT ON TABLE task_templates IS
  'Templates de tâches auto-générées à chaque transition de phase. Livraison inclut le workflow VCT + PV de réception.';
