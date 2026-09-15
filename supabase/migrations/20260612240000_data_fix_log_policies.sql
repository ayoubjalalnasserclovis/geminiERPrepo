-- ════════════════════════════════════════════════════════════════════════════
-- QA-BUG-014 (S2) — data_fix_log : RLS activée sans AUCUNE policy
--
-- Constat (test JWT ceo direct BDD) : SELECT data_fix_log → 0 ligne pour tout
-- rôle applicatif. Or les imports CSV travaux et achats utilisent le client
-- USER (anon key + session) pour :
--   1. vérifier si l'import a déjà été joué (count sur data_fix_log) → toujours 0
--      ⇒ le blocage re-run documenté NE FONCTIONNAIT PAS ;
--   2. écrire le snapshot d'audit → INSERT refusé en silence (non vérifié)
--      ⇒ aucun audit d'import écrit depuis l'app.
-- Vérifié en prod : pas de doublon d'import constaté à ce jour (latent).
--
-- Cause racine : table créée avec ENABLE ROW LEVEL SECURITY sans CREATE POLICY.
--
-- Fix : lecture + insertion pour l'équipe (is_staff()), pas d'UPDATE/DELETE
-- (journal d'audit append-only ; les rollbacks passent par service_role).
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS data_fix_log_staff_read ON public.data_fix_log;
CREATE POLICY data_fix_log_staff_read ON public.data_fix_log
  FOR SELECT USING (is_staff());

DROP POLICY IF EXISTS data_fix_log_staff_insert ON public.data_fix_log;
CREATE POLICY data_fix_log_staff_insert ON public.data_fix_log
  FOR INSERT WITH CHECK (is_staff());
