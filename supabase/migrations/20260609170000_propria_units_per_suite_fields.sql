-- ─── Refonte fiche bien Propria (CEO 2026-06-09) ──────────────────────
-- 8 champs étaient sur properties alors qu'ils sont par-suite. On les
-- déplace vers propria_units :
--   • nb_keys, key_box_home, key_box_location  (logement individuel)
--   • smart_lock                                (équipement de la suite)
--   • arrival_video_url, arrival_instructions  (vidéo/instructions check-in)
--   • wifi_ssid, wifi_password                  (souvent par suite)
-- Les champs sur properties sont CONSERVÉS 30 jours pour rollback,
-- juste retirés du form. Cleanup à programmer pour 2026-07-09.
--
-- Code serrure logement (lock_code) RESTE au niveau du bien (CEO Q1).

ALTER TABLE public.propria_units
  ADD COLUMN IF NOT EXISTS propria_key_box_home          text,
  ADD COLUMN IF NOT EXISTS propria_key_box_location      text,
  ADD COLUMN IF NOT EXISTS propria_arrival_video_url     text,
  ADD COLUMN IF NOT EXISTS propria_arrival_instructions  text;

COMMENT ON COLUMN public.propria_units.propria_key_box_home IS
  'Boîte à clés du logement (par suite). Déplacé depuis properties le 2026-06-09.';
COMMENT ON COLUMN public.propria_units.propria_key_box_location IS
  'Emplacement de la boîte à clés (par suite). Déplacé depuis properties le 2026-06-09.';
COMMENT ON COLUMN public.propria_units.propria_arrival_video_url IS
  'URL vidéo d''arrivée (par suite). Déplacé depuis properties le 2026-06-09.';
COMMENT ON COLUMN public.propria_units.propria_arrival_instructions IS
  'Instructions check-in (par suite). Déplacé depuis properties le 2026-06-09.';

-- Backfill : copier la valeur du bien sur TOUTES ses suites actives
-- Garde-fou : COALESCE préserve les valeurs déjà saisies sur la suite.
UPDATE public.propria_units u
SET
  propria_key_box_home          = COALESCE(u.propria_key_box_home,         p.propria_key_box_home),
  propria_key_box_location      = COALESCE(u.propria_key_box_location,     p.propria_key_box_location),
  propria_arrival_video_url     = COALESCE(u.propria_arrival_video_url,    p.propria_arrival_video_url),
  propria_arrival_instructions  = COALESCE(u.propria_arrival_instructions, p.propria_arrival_instructions),
  propria_nb_keys               = COALESCE(u.propria_nb_keys,              p.propria_nb_keys),
  propria_wifi_ssid             = COALESCE(u.propria_wifi_ssid,            p.propria_wifi_ssid),
  propria_wifi_password         = COALESCE(u.propria_wifi_password,        p.propria_wifi_password),
  -- smart_lock NOT NULL DEFAULT false sur units : ne backfill que si bien=true et suite=false
  propria_smart_lock = CASE
    WHEN u.propria_smart_lock = false AND p.propria_smart_lock = true THEN true
    ELSE u.propria_smart_lock
  END,
  updated_at = now()
FROM public.properties p
WHERE u.property_id = p.id
  AND u.deleted_at IS NULL
  AND u.is_active = true
  AND p.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
