-- QA-BUG-024 (décision CEO 2026-06-13) : suppression (soft-delete) projet = CEO-only.
-- Garde-fou base en plus du guard applicatif (deleteProjectAction → assertRole ceo,
-- bouton UI ceo-only). Empêche un chef_projet de poser deleted_at via API directe.
-- Contexte service_role (auth.uid() NULL) autorisé (scripts/admin).
-- Le trigger ne se déclenche QUE sur la transition deleted_at null→not-null :
-- les updates projet normaux et le restore (not-null→null) ne sont pas affectés.
CREATE OR REPLACE FUNCTION public.enforce_ceo_only_project_softdelete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    IF auth.uid() IS NOT NULL AND NOT is_staff(ARRAY['ceo']) THEN
      RAISE EXCEPTION 'Suppression de projet réservée au CEO';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ceo_only_project_softdelete ON public.projects;
CREATE TRIGGER trg_ceo_only_project_softdelete
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ceo_only_project_softdelete();
