-- ─── Rétro chantier 4 : classification A/B/C/D + résumé exécutif ─────────
--
-- Les colonnes final_classification et final_summary ont été ajoutées
-- directement en prod via MCP lors du marathon chantier 4 — aucune migration
-- n'avait été commitée. Cette migration rétro aligne le repo sur la prod.
--
-- final_classification = grade A/B/C/D donné à la validation back-office :
--   A = parfait      / B = mineur à corriger
--   C = travaux requis / D = bloquant (réservation à interdire)
--
-- final_summary = pavé texte saisi à la validation (synthèse pour le client).

ALTER TABLE public.propria_checkups
  ADD COLUMN IF NOT EXISTS final_classification text,
  ADD COLUMN IF NOT EXISTS final_summary        text;

-- CHECK constraint idempotent (A/B/C/D ou NULL si pas encore validé)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'propria_checkups_final_classification_check'
  ) THEN
    ALTER TABLE public.propria_checkups
      ADD CONSTRAINT propria_checkups_final_classification_check
      CHECK (final_classification IS NULL OR final_classification IN ('A','B','C','D'));
  END IF;
END $$;

COMMENT ON COLUMN public.propria_checkups.final_classification IS
  'Grade A/B/C/D donné à la validation back-office (chantier 4) — A parfait, B mineur, C travaux, D bloquant.';
COMMENT ON COLUMN public.propria_checkups.final_summary IS
  'Résumé exécutif rédigé à la validation (chantier 4) — synthèse pour le client / dashboard /qualite.';

NOTIFY pgrst, 'reload schema';
