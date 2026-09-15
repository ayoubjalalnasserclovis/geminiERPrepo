-- ============================================================================
-- Phase Design — tâche "Signature de l'acte authentique"
-- + flag d'envoi email pour éviter les notifications en double
-- ============================================================================

-- 1. Flag d'envoi de l'email félicitations au client
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS acte_authentique_notified_at TIMESTAMPTZ;

-- 2. Tâche bloquante en phase design
INSERT INTO task_templates (phase, title, description, default_assigned_role, order_index, is_blocking)
VALUES
  ('design', 'Faire signer l''acte authentique chez le notaire',
   'Coordonner avec le notaire la signature de l''acte authentique avec le client. Une fois la signature effectuée, renseigner la date de signature dans le projet (champ "Date acte authentique") — la tâche sera automatiquement marquée comme terminée et le client recevra une notification.',
   'chef_projet', 5, true)
ON CONFLICT DO NOTHING;
