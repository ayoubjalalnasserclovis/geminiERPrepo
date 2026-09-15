-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 20260828120000_fix_views_security_invoker_and_anon_grants.sql
--
-- À N'EXÉCUTER QUE si un écran d'équipe se vide après l'application et qu'on
-- a besoin de rouvrir le temps de corriger la policy fautive.
--
-- ⚠ Exécuter ce script REMET LA FUITE EN PLACE : les 13 vues redeviennent
--   lisibles sans authentification (RIB/IBAN propriétaires, codes d'accès,
--   mots de passe wifi, soldes bancaires, P&L par projet).
--   Ne jamais le laisser en place plus que le temps du diagnostic.
--
-- ALTERNATIVE PRÉFÉRABLE au rollback complet : ne rouvrir QUE la vue
-- concernée (une seule paire de lignes ci-dessous), et corriger la policy
-- manquante sur la table source dans la foulée.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER VIEW public.properties_enriched                    SET (security_invoker = off);
ALTER VIEW public.properties_publication_status          SET (security_invoker = off);
ALTER VIEW public.v_property_completeness                SET (security_invoker = off);
ALTER VIEW public.v_property_propria_kpis                SET (security_invoker = off);
ALTER VIEW public.artisans_completeness                  SET (security_invoker = off);
ALTER VIEW public.v_bank_account_current_balance         SET (security_invoker = off);
ALTER VIEW public.stoniz_wallet_balances                 SET (security_invoker = off);
ALTER VIEW public.stoniz_project_cash_pl                 SET (security_invoker = off);
ALTER VIEW public.propria_wallet_balances                SET (security_invoker = off);
ALTER VIEW public.propria_interventions_enriched         SET (security_invoker = off);
ALTER VIEW public.propria_cleanings_enriched             SET (security_invoker = off);
ALTER VIEW public.v_propria_unit_completeness            SET (security_invoker = off);
ALTER VIEW public.v_propria_listing_monthly_performance  SET (security_invoker = off);

-- Le GRANT à anon n'est volontairement PAS restauré : aucun chemin applicatif
-- non authentifié ne lit ces vues (vérifié — /upsell passe par le compte de
-- service). Le rouvrir n'aurait aucune utilité et rétablirait la fuite
-- publique. Si un besoin apparaissait, la ligne serait :
--   GRANT SELECT ON public.<vue> TO anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
