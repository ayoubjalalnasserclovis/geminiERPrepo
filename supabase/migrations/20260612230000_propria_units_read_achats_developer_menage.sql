-- ════════════════════════════════════════════════════════════════════════════
-- QA-BUG-012 (S2) — Rôles achats / developer / menage aveugles sur propria_units
--
-- Constat (test RLS direct BDD, 12 rôles) : propria_units visibles = 79 lignes
-- pour ceo/chef/sourcing/commercial/finance/marketing/assistante/propria,
-- mais 0 ligne pour achats, developer et menage.
-- Or la page /projects/[id]/achats (autorisée au rôle achats et developer)
-- requête propria_units pour lier les lots aux suites → dropdown suites VIDE
-- pour ces rôles, liaison lot↔suite impossible. Le rôle menage intervient sur
-- les units (ménages par suite) et lit déjà propria_cleanings.
--
-- Cause racine : policy propria_units_staff_all à liste de rôles figée
-- (antérieure aux rôles achats/developer/menage), pas de policy de lecture
-- complémentaire.
--
-- Fix minimal : policy SELECT pour toute l'équipe via is_staff() (lecture
-- seule — les écritures restent réservées à la liste existante + propria).
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS propria_units_staff_read ON public.propria_units;
CREATE POLICY propria_units_staff_read ON public.propria_units
  FOR SELECT USING (is_staff());
