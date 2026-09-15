-- ─── Cleanup propria_units (CEO 2026-06-09 corr.) ─────────────────────
-- 1. « Boîte à clés du logement » et « Boîte à clés du lot » désignent la
--    MÊME chose. On garde key_box_suite (libellé « Boîte à clés du lot »)
--    et on supprime définitivement key_box_home (ajouté ce matin par erreur).
-- 2. « Admin serrure connectée » (smart_lock) reste au niveau du BIEN — on
--    n'expose plus le champ dans le form de la suite. La colonne sur la
--    suite reste en BDD (NOT NULL DEFAULT false) pour rétro-compat.

-- 1) Fusion key_box_home → key_box_suite (sans écraser une valeur existante)
UPDATE public.propria_units
SET propria_key_box_suite = COALESCE(propria_key_box_suite, propria_key_box_home),
    updated_at = now()
WHERE propria_key_box_home IS NOT NULL
  AND propria_key_box_suite IS NULL;

-- 2) DROP COLUMN propria_key_box_home (définitif)
ALTER TABLE public.propria_units
  DROP COLUMN IF EXISTS propria_key_box_home;

NOTIFY pgrst, 'reload schema';
