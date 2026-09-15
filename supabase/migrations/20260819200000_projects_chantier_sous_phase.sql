-- Sous-phase du chantier travaux — CEO 2026-08-19.
--
-- Contexte : le brief hebdo travaux veut regrouper les chantiers actifs
-- par sous-phase (gros_œuvre / second_œuvre / finitions / livré) pour
-- donner au CEO une vue "où en est-on ?" plus fine que la phase globale
-- 'travaux'.
--
-- ATTENTION : cette migration est POSÉE mais volontairement PAS ENCORE
-- APPLIQUÉE en prod. Il faut :
--   1) Ajouter le sélecteur sur /projects/[id]/travaux (UI)
--   2) Backfiller les valeurs sur les chantiers en cours
--   3) Appliquer la migration
-- Sans ces 3 étapes, le brief travaux reste sur "sans sous-phase" pour
-- tous les projets — comportement inoffensif prévu par le code.
--
-- Colonne NULLABLE sans default : par construction "pas encore
-- renseigné" jusqu'à saisie explicite par le chef de projet.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chantier_sous_phase_t') THEN
    CREATE TYPE chantier_sous_phase_t AS ENUM (
      'gros_oeuvre',
      'second_oeuvre',
      'finitions',
      'livre'
    );
  END IF;
END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS chantier_sous_phase chantier_sous_phase_t;

COMMENT ON COLUMN public.projects.chantier_sous_phase IS
  'Sous-phase du chantier (uniquement pertinent quand current_phase = travaux). '
  'NULL = non renseigné. Alimenté manuellement par le chef de projet sur '
  '/projects/[id]/travaux. Utilisé par le brief hebdo travaux pour '
  'grouper les chantiers actifs.';

CREATE INDEX IF NOT EXISTS projects_chantier_sous_phase_idx
  ON public.projects (chantier_sous_phase)
  WHERE chantier_sous_phase IS NOT NULL AND deleted_at IS NULL;
