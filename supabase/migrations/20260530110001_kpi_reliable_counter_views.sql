-- ════════════════════════════════════════════════════════════════════════════
-- #3 — Vues fiables : recalculer les compteurs au lieu de lire des colonnes
--      dénormalisées non maintenues. Règle validée : pour les KPIs, on lit
--      CES VUES, jamais les colonnes-compteurs (qui mentent).
--
--  • projects.nb_properties_presented  → jamais incrémenté (resté à 0)
--  • projects.nb_properties_accepted/refused → incrémentés mais jamais décrémentés
--  • projects.travaux_total_paid       → DEFAULT 0, aucun trigger d'agrégation
--  • artisans.nb_lots_total / ca_total_mad → "à la demande", donc périmés
-- ════════════════════════════════════════════════════════════════════════════

-- a) Stats propositions par projet (source de vérité = property_proposals)
-- security_invoker : le RLS des tables sous-jacentes s'applique (un chef de projet
-- ne voit que ses projets ; le CEO/admin voit tout).
CREATE OR REPLACE VIEW v_project_proposal_stats
  WITH (security_invoker = on) AS
SELECT
  project_id,
  COUNT(*)                                             AS nb_presented,
  COUNT(*) FILTER (WHERE client_response = 'accepted') AS nb_accepted,
  COUNT(*) FILTER (WHERE client_response = 'refused')  AS nb_refused,
  COUNT(*) FILTER (WHERE client_response = 'pending')  AS nb_pending
FROM property_proposals
GROUP BY project_id;

-- b) Travaux réellement payés / engagés par projet (source = travaux_payments)
CREATE OR REPLACE VIEW v_project_travaux_paid
  WITH (security_invoker = on) AS
SELECT
  project_id,
  COALESCE(SUM(amount_paid),  0) AS travaux_total_paid_mad,
  COALESCE(SUM(amount_total), 0) AS travaux_total_engaged_mad
FROM travaux_payments
WHERE deleted_at IS NULL
GROUP BY project_id;

-- c) Activité réelle par artisan/fournisseur, calculée depuis les LOTS
--    (travaux_lots.devis_artisan_mad + achats_lots.devis_fournisseur_mad).
--    On n'utilise pas les tables de paiements : elles ne portent pas d'artisan_id.
CREATE OR REPLACE VIEW v_artisan_activity
  WITH (security_invoker = on) AS
WITH lots AS (
  SELECT artisan_id  AS artisan_id, devis_artisan_mad     AS montant_mad
    FROM travaux_lots WHERE artisan_id  IS NOT NULL AND deleted_at IS NULL
  UNION ALL
  SELECT supplier_id AS artisan_id, devis_fournisseur_mad AS montant_mad
    FROM achats_lots  WHERE supplier_id IS NOT NULL AND deleted_at IS NULL
)
SELECT
  a.id   AS artisan_id,
  a.name AS artisan_name,
  COUNT(l.artisan_id)             AS nb_lots_total,
  COALESCE(SUM(l.montant_mad), 0) AS ca_total_mad
FROM artisans a
LEFT JOIN lots l ON l.artisan_id = a.id
GROUP BY a.id, a.name;
