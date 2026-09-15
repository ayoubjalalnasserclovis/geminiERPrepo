-- ─── Settings check-ups : alignement défauts (audit CEO 2026-06-18) ──────
--
-- L'audit signalait 4 settings absents en prod (random_office_per_day,
-- random_office_pct, random_terrain_per_week, logement_du_jour_enabled).
-- Vérification au 2026-06-19 : tous présents. Cette migration documentaire
-- + idempotente garantit qu'un environnement frais (dev/staging) ait les
-- mêmes valeurs par défaut que la prod, alignées sur SETTINGS_DEFAULTS de
-- lib/propria/checkups-auto.ts.
--
-- Valeurs par défaut (cohérentes avec lib/propria/checkups-auto.ts) :
--   checkup_every_months       = 3
--   checkup_every_stays        = 10
--   deep_cleaning_every_stays  = 10
--   random_office_per_day      = 5
--   random_office_pct          = 10   (10% des nettoyés la veille)
--   random_terrain_per_week    = 3    (LUN/MER/VEN, porté par le cron)
--   logement_du_jour_enabled   = true

INSERT INTO public.propria_settings (key, value) VALUES
  ('checkup_every_months',      '3'::jsonb),
  ('checkup_every_stays',       '10'::jsonb),
  ('deep_cleaning_every_stays', '10'::jsonb),
  ('random_office_per_day',     '5'::jsonb),
  ('random_office_pct',         '10'::jsonb),
  ('random_terrain_per_week',   '3'::jsonb),
  ('logement_du_jour_enabled',  'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
