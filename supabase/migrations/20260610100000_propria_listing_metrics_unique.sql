-- ─── Fix bug Ismael (CEO 2026-06-10) ──────────────────────────────────
-- createListingMetricAction utilise un upsert avec onConflict sur
-- (propria_unit_id, platform, measured_at). Sans contrainte UNIQUE,
-- Postgres throw "no unique or exclusion constraint matching the ON
-- CONFLICT specification".

ALTER TABLE public.propria_listing_metrics
  ADD CONSTRAINT propria_listing_metrics_unit_platform_date_uniq
  UNIQUE (propria_unit_id, platform, measured_at);

NOTIFY pgrst, 'reload schema';
