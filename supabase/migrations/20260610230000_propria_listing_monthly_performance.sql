-- Vue de performance mensuelle par suite Hostaway (CEO 2026-06-10).
-- Cf migration prod : 12 mois glissants, occupation + revenu prorata + notes.
-- Voir le fichier prod via supabase MCP pour le détail.

CREATE OR REPLACE VIEW public.v_propria_listing_monthly_performance AS
WITH months AS (
  SELECT
    date_trunc('month', generate_series(
      date_trunc('month', now() - interval '11 months'),
      date_trunc('month', now()),
      interval '1 month'
    ))::date AS month_start
),
months_full AS (
  SELECT
    month_start,
    (month_start + interval '1 month')::date AS month_end_excl,
    EXTRACT(DAY FROM (month_start + interval '1 month' - interval '1 day'))::int AS nights_in_month
  FROM months
),
units AS (
  SELECT
    hl.id              AS hostaway_listing_db_id,
    hl.hostaway_id     AS hostaway_listing_id,
    hl.name            AS listing_name,
    hl.propria_unit_id,
    pu.code            AS unit_code,
    p.name             AS property_name,
    p.id               AS property_id
  FROM public.hostaway_listings hl
  LEFT JOIN public.propria_units pu ON pu.id = hl.propria_unit_id AND pu.deleted_at IS NULL
  LEFT JOIN public.properties p     ON p.id = pu.property_id     AND p.deleted_at IS NULL
  WHERE hl.deleted_at IS NULL AND hl.is_active = true
),
active_resas AS (
  SELECT
    r.hostaway_listing_db_id,
    r.arrival_date,
    r.departure_date,
    r.nights,
    r.total_price
  FROM public.hostaway_reservations r
  WHERE r.deleted_at IS NULL
    AND r.status IN ('new','modified')
    AND r.hostaway_listing_db_id IS NOT NULL
    AND r.arrival_date < r.departure_date
),
resa_nights AS (
  SELECT
    ar.hostaway_listing_db_id,
    night_date,
    COALESCE(ar.total_price, 0) /
      NULLIF(GREATEST(ar.nights, (ar.departure_date - ar.arrival_date))::numeric, 0) AS price_per_night
  FROM active_resas ar
  CROSS JOIN LATERAL generate_series(
    ar.arrival_date::date,
    (ar.departure_date - interval '1 day')::date,
    interval '1 day'
  ) AS night_date
),
nights_per_month AS (
  SELECT
    rn.hostaway_listing_db_id,
    date_trunc('month', rn.night_date)::date AS month_start,
    COUNT(*) AS nights_occupied,
    SUM(COALESCE(rn.price_per_night, 0)) AS revenue
  FROM resa_nights rn
  GROUP BY 1, 2
),
reviews_per_month AS (
  SELECT
    hr.hostaway_listing_db_id,
    date_trunc('month', hr.submitted_at)::date AS month_start,
    COUNT(*) AS nb_reviews,
    AVG(hr.rating_normalized) AS avg_rating
  FROM public.hostaway_reviews hr
  WHERE hr.deleted_at IS NULL
    AND hr.rating_normalized IS NOT NULL
    AND hr.hostaway_listing_db_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  u.hostaway_listing_db_id,
  u.hostaway_listing_id,
  u.listing_name,
  u.propria_unit_id,
  u.unit_code,
  u.property_id,
  u.property_name,
  mf.month_start,
  mf.nights_in_month,
  COALESCE(npm.nights_occupied, 0) AS nights_occupied,
  ROUND(
    COALESCE(npm.nights_occupied, 0)::numeric
      / NULLIF(mf.nights_in_month, 0),
    4
  ) AS occupancy_rate,
  ROUND(COALESCE(npm.revenue, 0)::numeric, 2) AS revenue,
  COALESCE(rpm.nb_reviews, 0) AS nb_reviews,
  ROUND(rpm.avg_rating::numeric, 2) AS avg_rating
FROM units u
CROSS JOIN months_full mf
LEFT JOIN nights_per_month npm
  ON npm.hostaway_listing_db_id = u.hostaway_listing_db_id
 AND npm.month_start = mf.month_start
LEFT JOIN reviews_per_month rpm
  ON rpm.hostaway_listing_db_id = u.hostaway_listing_db_id
 AND rpm.month_start = mf.month_start
ORDER BY u.listing_name, mf.month_start;

GRANT SELECT ON public.v_propria_listing_monthly_performance TO authenticated;

COMMENT ON VIEW public.v_propria_listing_monthly_performance IS
  'Performance mensuelle par listing Hostaway sur 12 mois glissants. Occupation = nuits louées / jours du mois. Revenu alloué au prorata des nuits dans le mois. Note + nb avis du mois.';
