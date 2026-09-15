-- ============================================================================
-- Mise à jour du libellé de la tâche acompte : 3 000 € → 5 000 €
-- + Marquer la tâche d'envoi email comme non-bloquante (sera automatisée)
-- ============================================================================

UPDATE task_templates
SET title = 'Encaisser acompte Stoniz (5 000 €)'
WHERE phase = 'onboarding'
  AND title = 'Encaisser acompte Stoniz (3 000 €)';

-- L'envoi du mail de bienvenue est désormais automatique à la création du projet.
-- On garde la tâche pour l'historique mais elle est non-bloquante.
UPDATE task_templates
SET is_blocking = false,
    description = 'Email envoyé automatiquement à la création du projet (cocher pour confirmer la réception)'
WHERE phase = 'onboarding'
  AND title = 'Envoyer email de bienvenue + accès portail';
