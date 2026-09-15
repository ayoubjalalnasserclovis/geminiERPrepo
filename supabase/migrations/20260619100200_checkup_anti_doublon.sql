-- ─── Anti-doublon checkups manuels (audit CEO 2026-06-18) ────────────────
--
-- Bug identifié : sur /propria/checkups/new on peut créer 2 check-ups le même
-- jour sur le même lot (ou bien entier) — l'action n'a pas de garde unicité.
-- Ces index uniques partiels bloquent la création d'un 2e check-up OUVERT
-- (a_faire / en_cours / a_valider) sur la même cible et la même due_date.
--
-- Limites volontaires :
--   • ne bloque que les check-ups OUVERTS — si le 1er est validé/annulé/
--     soft-deleted, on peut en recréer un (re-passage, faux départ)
--   • 2 index séparés (lot vs bien entier) parce que NULL ne joue pas
--     avec UNIQUE multi-colonnes en Postgres → on filtre via WHERE partiel
--   • due_date NULL (cas « aucun créneau ») est ignoré par les 2 index
--     (clause WHERE … = … impose NOT NULL implicitement via égalité)

-- 1) Cas lot (propria_unit_id NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_propria_checkups_unique_per_day_unit
  ON public.propria_checkups (propria_unit_id, due_date)
  WHERE deleted_at IS NULL
    AND status IN ('a_faire','en_cours','a_valider')
    AND propria_unit_id IS NOT NULL
    AND due_date IS NOT NULL;

-- 2) Cas bien entier (property_id NOT NULL, propria_unit_id NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_propria_checkups_unique_per_day_property
  ON public.propria_checkups (property_id, due_date)
  WHERE deleted_at IS NULL
    AND status IN ('a_faire','en_cours','a_valider')
    AND propria_unit_id IS NULL
    AND property_id IS NOT NULL
    AND due_date IS NOT NULL;

COMMENT ON INDEX public.idx_propria_checkups_unique_per_day_unit IS
  'Anti-doublon check-up OUVERT par lot et par due_date (audit CEO 2026-06-18).';
COMMENT ON INDEX public.idx_propria_checkups_unique_per_day_property IS
  'Anti-doublon check-up OUVERT par bien entier et par due_date (audit CEO 2026-06-18).';
