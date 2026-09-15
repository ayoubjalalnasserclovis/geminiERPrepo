-- Auto-fill travaux_end_date = travaux_start_date + 6 mois (CEO 2026-08-19d)
--
-- Regle metier : dans 100% des cas Stoniz, un chantier dure 6 mois
-- environ. Le CEO ne veut plus avoir a saisir la date de fin prevue a
-- la main. Trigger defensif :
--   - Fire uniquement si travaux_end_date IS NULL au moment de l'INSERT/UPDATE
--   - Ne touche JAMAIS a une valeur end deja saisie (le chef de projet garde
--     la main pour ajuster manuellement s'il faut plus/moins de 6 mois)
--
-- Migration deja appliquee en prod le 2026-08-19 (apply_migration).
-- Ce fichier existe pour versionner l'historique + faciliter les futurs
-- resets d'env dev.

CREATE OR REPLACE FUNCTION public.trg_auto_fill_travaux_end_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.travaux_start_date IS NOT NULL AND NEW.travaux_end_date IS NULL THEN
    NEW.travaux_end_date := (NEW.travaux_start_date::date + INTERVAL '6 months')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_fill_travaux_end_date ON public.projects;

CREATE TRIGGER auto_fill_travaux_end_date
BEFORE INSERT OR UPDATE OF travaux_start_date, travaux_end_date ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.trg_auto_fill_travaux_end_date();

COMMENT ON FUNCTION public.trg_auto_fill_travaux_end_date() IS
  'Auto-remplit travaux_end_date a travaux_start_date + 6 mois si start renseigne et end vide. Ne touche jamais a une valeur end deja saisie. CEO 2026-08-19d.';

-- Backfill immediat des projets existants (4 projets identifies au 2026-08-19).
-- Snapshot dans data_fix_log pour reversibilite.
WITH projets_a_backfill AS (
  SELECT id, reference, travaux_start_date
  FROM projects
  WHERE deleted_at IS NULL
    AND status <> 'perdu'
    AND travaux_start_date IS NOT NULL
    AND travaux_end_date IS NULL
),
snapshots AS (
  INSERT INTO data_fix_log (id, fix_name, entity, entity_id, snapshot, applied_at)
  SELECT gen_random_uuid(),
         'backfill_travaux_end_date_2026-08-19',
         'projects',
         id::text,
         jsonb_build_object(
           'reference', reference,
           'old_travaux_end_date', null,
           'set_to', (travaux_start_date::date + INTERVAL '6 months')::date,
           'reason', 'Regle metier : chantier = 6 mois par defaut'
         ),
         now()
  FROM projets_a_backfill
  ON CONFLICT DO NOTHING
  RETURNING entity_id
)
UPDATE projects p
SET travaux_end_date = (p.travaux_start_date::date + INTERVAL '6 months')::date,
    updated_at = now()
FROM projets_a_backfill pa
WHERE p.id = pa.id
  AND p.travaux_end_date IS NULL; -- idempotence si rejoue
