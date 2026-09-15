-- ============================================================================
-- BUNDLE CEO 2026-05-30 — Exclusion projets perdus des vues dashboard
-- ============================================================================
-- Règle métier permanente : un projet status='perdu' est exclu de TOUTES les
-- stats / dashboards / agrégats / tableaux détail par défaut.
--
-- Cette migration met à jour les VUES SQL agrégatives qui ne filtraient pas
-- les projets perdus. Côté applicatif (TypeScript), le filtre est appliqué
-- via lib/projects/lost.ts (helper centralisé).
--
-- Source de vérité : projects.status = 'perdu' (dynamique — un projet qui
-- repasse "actif" réapparaît automatiquement dans la vue).
-- ============================================================================

BEGIN;

-- ─── satisfaction_dashboard : exclure les enquêtes liées à un projet perdu ──
-- DROP + CREATE (et non CREATE OR REPLACE) car on ajoute une colonne project_status
-- au milieu de la liste — Postgres refuse le REPLACE si l'ordre change.
DROP VIEW IF EXISTS satisfaction_dashboard;
CREATE VIEW satisfaction_dashboard AS
SELECT
  s.id,
  s.project_id,
  s.client_id,
  s.trigger_phase,
  s.sent_at,
  s.completed_at,
  s.global_score,
  s.communication_score,
  s.reactivity_score,
  s.quality_score,
  s.deadline_score,
  s.nps_score,
  s.comment,
  s.nps_comment,
  p.reference AS project_reference,
  p.current_phase,
  p.status AS project_status,
  c.full_name AS client_name,
  c.email AS client_email,
  pr.full_name AS chef_name,
  CASE WHEN s.completed_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (s.completed_at - s.sent_at)) / 3600
    ELSE NULL END AS completion_hours
FROM satisfaction_surveys s
JOIN projects p ON p.id = s.project_id
LEFT JOIN clients c ON c.id = s.client_id
LEFT JOIN profiles pr ON pr.id = p.assigned_chef_projet
-- Règle métier permanente : exclusion projets perdus (CEO 2026-05-30)
WHERE p.status <> 'perdu'
  AND p.deleted_at IS NULL;

ALTER VIEW satisfaction_dashboard SET (security_invoker = on);

COMMIT;
