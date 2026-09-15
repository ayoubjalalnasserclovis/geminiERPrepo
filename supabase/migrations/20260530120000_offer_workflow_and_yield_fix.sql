-- ============================================================================
-- BUNDLE CEO 2026-05-30 — Workflow offre / rendement brut / négociation
-- ============================================================================
-- 1. Date sourcing : DEFAULT current_date + backfill non-destructif
-- 2. Offre client : nouvelles colonnes projects.offer_date + offer_price
--    (la donnée vit côté projet — c'est le chef de projet qui la saisit)
-- 3. Négociation : properties.initial_asking_price (prix vendeur initial)
-- 4. Vue properties_enriched ré-écrite :
--    - gross_yield calculé sur coût total (prix + notaire + agence + travaux + 21k Stoniz)
--    - days_sourcing_to_offer agrégé via MIN(projects.offer_date) — Option A retenue
--    - first_offer_date exposé en lecture
--    - negotiation_amount calculé (initial_asking_price - price)
--
-- Idempotent. Pas de DROP destructif sur properties.offer_date :
-- la colonne reste en base pour compatibilité, mais n'est plus utilisée
-- par la vue ni l'UI. Cleanup +30j si besoin.
-- ============================================================================

BEGIN;

-- ─── (1) sourcing_date : DEFAULT + backfill ────────────────────────────────
ALTER TABLE properties
  ALTER COLUMN sourcing_date SET DEFAULT current_date;

-- Backfill non-destructif : ne touche que les biens où sourcing_date est NULL,
-- en utilisant created_at::date comme fallback raisonnable.
UPDATE properties
   SET sourcing_date = created_at::date
 WHERE sourcing_date IS NULL
   AND deleted_at IS NULL;

-- ─── (2) projects.offer_date + projects.offer_price ────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS offer_date  DATE,
  ADD COLUMN IF NOT EXISTS offer_price NUMERIC(14,2);

COMMENT ON COLUMN projects.offer_date  IS
  'Date à laquelle le client a fait son offre au vendeur (saisi par chef de projet).';
COMMENT ON COLUMN projects.offer_price IS
  'Montant de l''offre faite par le client (€).';

CREATE INDEX IF NOT EXISTS projects_offer_date_idx
  ON projects (offer_date)
  WHERE deleted_at IS NULL AND offer_date IS NOT NULL;

-- ─── (3) properties.initial_asking_price (Négociation) ─────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS initial_asking_price NUMERIC(14,2);

COMMENT ON COLUMN properties.initial_asking_price IS
  'Prix demandé par le vendeur initialement (avant négo). NULL = pas de négo connue.';

-- ─── (4) Vue properties_enriched : nouvelle formule rendement + agrégats ───
DROP VIEW IF EXISTS properties_enriched;

CREATE VIEW properties_enriched AS
WITH first_offers AS (
  -- Première offre client posée pour chaque bien (Option A : MIN)
  SELECT property_id,
         MIN(offer_date) AS first_offer_date,
         COUNT(*)        AS nb_offers
    FROM projects
   WHERE deleted_at IS NULL
     AND offer_date IS NOT NULL
   GROUP BY property_id
)
SELECT
  p.*,

  -- ─── Rendement brut : formule métier complète ─────────────────────────
  -- Loyer annuel : préférer revenu_locatif_brut_annuel, sinon estimated_rent × 12
  -- Coût total  : prix + notaire + agence + travaux + 21 000 € (frais Stoniz fixes)
  CASE
    WHEN COALESCE(p.price, 0) > 0
     AND COALESCE(p.revenu_locatif_brut_annuel, p.estimated_rent * 12) IS NOT NULL
    THEN ROUND(
      COALESCE(p.revenu_locatif_brut_annuel, p.estimated_rent * 12)
      / (
          COALESCE(p.price, 0)
        + COALESCE(p.notary_fees, 0)
        + COALESCE(p.agency_fees, 0)
        + COALESCE(p.travaux_budget_estimate, 0)
        + 21000
        ) * 100,
      2
    )
    ELSE NULL
  END AS gross_yield,

  -- ─── Commission sourcing ──────────────────────────────────────────────
  CASE
    WHEN p.price IS NOT NULL
    THEN ROUND(p.price * (p.sourcing_commission_rate / 100), 2)
    ELSE NULL
  END AS sourcing_commission_amount,

  -- ─── Délai sourcing → offre (Option A : 1re offre reçue) ──────────────
  -- Vide tant qu'aucune offre n'a été posée par un client.
  CASE
    WHEN p.sourcing_date IS NOT NULL
     AND fo.first_offer_date IS NOT NULL
    THEN (fo.first_offer_date - p.sourcing_date)
    ELSE NULL
  END AS days_sourcing_to_offer,

  -- ─── Première offre reçue (lecture brute pour UI) ─────────────────────
  fo.first_offer_date,
  COALESCE(fo.nb_offers, 0) AS nb_offers_received,

  -- ─── Négociation (Prix vendeur initial − Prix retenu) ─────────────────
  CASE
    WHEN p.initial_asking_price IS NOT NULL
     AND p.price IS NOT NULL
     AND p.initial_asking_price > p.price
    THEN (p.initial_asking_price - p.price)
    ELSE 0
  END AS negotiation_amount,

  CASE
    WHEN p.initial_asking_price IS NOT NULL
     AND p.initial_asking_price > 0
     AND p.price IS NOT NULL
     AND p.initial_asking_price > p.price
    THEN ROUND((p.initial_asking_price - p.price) / p.initial_asking_price * 100, 2)
    ELSE NULL
  END AS negotiation_pct

FROM properties p
LEFT JOIN first_offers fo ON fo.property_id = p.id
WHERE p.deleted_at IS NULL;

-- ─── Vérification post-migration ───────────────────────────────────────────
SELECT
  '✅ Bundle CEO appliqué' AS section,
  (SELECT COUNT(*) FROM properties WHERE sourcing_date IS NULL AND deleted_at IS NULL) AS biens_sans_sourcing_date,
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NULL)                          AS biens_actifs,
  (SELECT COUNT(*) FROM properties_enriched WHERE gross_yield IS NOT NULL)            AS biens_avec_yield_calc;

COMMIT;
