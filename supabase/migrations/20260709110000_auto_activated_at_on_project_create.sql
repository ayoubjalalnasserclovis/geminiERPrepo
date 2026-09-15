-- ═══════════════════════════════════════════════════════════════════════
-- Trigger auto-remplissage activated_at à la création d'un projet
-- ═══════════════════════════════════════════════════════════════════════
--
-- Contexte (CEO 2026-07-09) : un projet créé en mode normal (non préparation,
-- non legacy_imported) avait activated_at=NULL par défaut. Or le garde-fou
-- can_notify_for_project exige activated_at IS NOT NULL pour laisser passer
-- les emails. Résultat : les projets créés en mode direct voyaient TOUS
-- leurs emails skipped en silence.
--
-- Ce trigger règle définitivement le problème : à l'INSERT d'un projet,
-- si is_preparation=false et legacy_imported=false, on force activated_at
-- à now() (sauf si l'appelant a explicitement fourni une valeur — dans ce
-- cas on la respecte).
--
-- Les projets créés via /admin/preparation restent gérés comme avant :
-- is_preparation=true à la création → activated_at reste NULL → sera rempli
-- au moment de l'activation manuelle.

CREATE OR REPLACE FUNCTION public.trg_auto_fill_activated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si activated_at est déjà fourni par l'appelant, on ne touche à rien.
  IF NEW.activated_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Si le projet est créé en mode normal (ni préparation ni legacy),
  -- on l'active immédiatement.
  IF COALESCE(NEW.is_preparation, false) = false
     AND COALESCE(NEW.legacy_imported, false) = false THEN
    NEW.activated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_fill_activated_at ON public.projects;

CREATE TRIGGER auto_fill_activated_at
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.trg_auto_fill_activated_at();

COMMENT ON FUNCTION public.trg_auto_fill_activated_at() IS
  'Auto-remplit activated_at à la création d''un projet si is_preparation=false et legacy_imported=false. CEO 2026-07-09 (bug emails skipped sur projet démo).';

-- ─── Backfill des projets existants dans le même cas ──────────────────────
-- Snapshot dans data_fix_log pour réversibilité.

WITH projets_a_activer AS (
  SELECT id, created_at
  FROM projects
  WHERE deleted_at IS NULL
    AND is_preparation = false
    AND legacy_imported = false
    AND activated_at IS NULL
),
snapshots AS (
  INSERT INTO data_fix_log (id, fix_name, entity, entity_id, snapshot, applied_at)
  SELECT gen_random_uuid(), 'backfill_activated_at_2026-07-09', 'projects', id::text,
         jsonb_build_object('old_activated_at', null, 'set_to', 'created_at'),
         now()
  FROM projets_a_activer
  RETURNING entity_id
)
UPDATE projects p
SET activated_at = COALESCE(p.created_at::timestamptz, now()),
    updated_at = now()
FROM projets_a_activer pa
WHERE p.id = pa.id;
