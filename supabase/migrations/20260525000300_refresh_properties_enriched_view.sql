-- ============================================================================
-- Recree la vue properties_enriched pour inclure les colonnes ajoutees apres
-- sa creation initiale (terrasse_m2, badge_label, travaux_budget_estimate, etc.)
--
-- PostgreSQL ne propage PAS les nouvelles colonnes a une vue creee avec SELECT *.
-- On recree donc la vue pour qu'elle voit le schema actuel de `properties`.
-- ============================================================================

DROP VIEW IF EXISTS properties_enriched;

CREATE VIEW properties_enriched AS
SELECT
  p.*,
  CASE WHEN p.price IS NOT NULL AND p.price > 0 AND p.estimated_rent IS NOT NULL
    THEN ROUND((p.estimated_rent * 12) / p.price * 100, 2)
    ELSE NULL END                                                      AS gross_yield,
  CASE WHEN p.price IS NOT NULL
    THEN ROUND(p.price * (p.sourcing_commission_rate / 100), 2)
    ELSE NULL END                                                      AS sourcing_commission_amount,
  CASE WHEN p.offer_date IS NOT NULL AND p.sourcing_date IS NOT NULL
    THEN (p.offer_date - p.sourcing_date)
    ELSE NULL END                                                      AS days_sourcing_to_offer
FROM properties p
WHERE p.deleted_at IS NULL;
