-- ============================================================================
-- CEO — Exclusion projets perdus des vues KPI "compteurs fiables"
-- ============================================================================
-- Règle métier permanente : un projet status='perdu' est exclu de TOUTES les
-- stats / dashboards / agrégats / tableaux détail par défaut (CEO 2026-05-30).
--
-- La migration 20260530130000 a déjà traité satisfaction_dashboard, mais les
-- 3 vues "compteurs fiables" créées par 20260530110001 agrégeaient encore les
-- tables enfant (travaux_payments, property_proposals, travaux_lots,
-- achats_lots) SANS filtrer le statut du projet parent. Un projet perdu
-- fuyait donc dans ces compteurs dès qu'ils étaient consommés.
--
-- Ici on réintroduit le filtre, en cohérence avec :
--   • lib/projects/lost.ts        (helper TS, côté applicatif)
--   • satisfaction_dashboard      (même prédicat : status <> 'perdu')
--
-- Dynamique : le filtre lit projects.status courant — un projet "ressuscité"
-- (perdu → actif) réapparaît automatiquement dans les vues, sans intervention.
--
-- Ré-inclusion explicite (include_lost) : ces vues ne sont PAS consommées par
-- les dashboards dédiés aux perdus (section "Cycle de vie" et carte "Projets
-- perdus" lisent projects / project_lifecycle_transition en direct). Aucune
-- vue compagnon n'est donc nécessaire ; la ré-inclusion reste possible via les
-- tables brutes ou le drapeau include_lost du helper TS.
--
-- RLS inchangée (security_invoker = on conservé). Aucune suppression de données.
-- CREATE OR REPLACE : la liste des colonnes de sortie reste identique, donc
-- Postgres accepte le REPLACE (seuls JOIN + WHERE internes changent).
-- ============================================================================

BEGIN;

-- a) Stats propositions par projet — exclure les projets perdus -------------
CREATE OR REPLACE VIEW v_project_proposal_stats
  WITH (security_invoker = on) AS
SELECT
  pp.project_id,
  COUNT(*)                                                AS nb_presented,
  COUNT(*) FILTER (WHERE pp.client_response = 'accepted') AS nb_accepted,
  COUNT(*) FILTER (WHERE pp.client_response = 'refused')  AS nb_refused,
  COUNT(*) FILTER (WHERE pp.client_response = 'pending')  AS nb_pending
FROM property_proposals pp
JOIN projects pr ON pr.id = pp.project_id
-- Règle métier permanente : exclusion projets perdus (CEO 2026-05-30)
WHERE pr.status <> 'perdu'
  AND pr.deleted_at IS NULL
GROUP BY pp.project_id;

-- b) Travaux payés / engagés par projet — exclure les projets perdus --------
CREATE OR REPLACE VIEW v_project_travaux_paid
  WITH (security_invoker = on) AS
SELECT
  tp.project_id,
  COALESCE(SUM(tp.amount_paid),  0) AS travaux_total_paid_mad,
  COALESCE(SUM(tp.amount_total), 0) AS travaux_total_engaged_mad
FROM travaux_payments tp
JOIN projects pr ON pr.id = tp.project_id
WHERE tp.deleted_at IS NULL
  -- Règle métier permanente : exclusion projets perdus (CEO 2026-05-30)
  AND pr.status <> 'perdu'
  AND pr.deleted_at IS NULL
GROUP BY tp.project_id;

-- c) Activité réelle par artisan/fournisseur — exclure les lots des projets
--    perdus (un lot rattaché à un projet perdu ne doit plus gonfler le CA
--    artisan ni le nombre de lots). -----------------------------------------
CREATE OR REPLACE VIEW v_artisan_activity
  WITH (security_invoker = on) AS
WITH lots AS (
  SELECT tl.artisan_id  AS artisan_id, tl.devis_artisan_mad     AS montant_mad
    FROM travaux_lots tl
    JOIN projects pr ON pr.id = tl.project_id
   WHERE tl.artisan_id IS NOT NULL
     AND tl.deleted_at IS NULL
     -- Règle métier permanente : exclusion projets perdus (CEO 2026-05-30)
     AND pr.status <> 'perdu'
     AND pr.deleted_at IS NULL
  UNION ALL
  SELECT al.supplier_id AS artisan_id, al.devis_fournisseur_mad AS montant_mad
    FROM achats_lots al
    JOIN projects pr ON pr.id = al.project_id
   WHERE al.supplier_id IS NOT NULL
     AND al.deleted_at IS NULL
     -- Règle métier permanente : exclusion projets perdus (CEO 2026-05-30)
     AND pr.status <> 'perdu'
     AND pr.deleted_at IS NULL
)
SELECT
  a.id   AS artisan_id,
  a.name AS artisan_name,
  COUNT(l.artisan_id)             AS nb_lots_total,
  COALESCE(SUM(l.montant_mad), 0) AS ca_total_mad
FROM artisans a
LEFT JOIN lots l ON l.artisan_id = a.id
GROUP BY a.id, a.name;

COMMIT;
