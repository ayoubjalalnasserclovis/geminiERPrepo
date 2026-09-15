-- ════════════════════════════════════════════════════════════════════════════
-- LOT A (contre-audit 2026-08-28) — Fuite de données via 13 vues SQL
--
-- PROBLÈME
-- Une vue Postgres créée sans l'option `security_invoker` s'exécute avec les
-- droits de son PROPRIÉTAIRE (postgres), pas avec ceux de l'appelant : toutes
-- les policies RLS des tables sous-jacentes sont ignorées. 13 vues étaient dans
-- ce cas ET portaient un `GRANT SELECT ... TO anon` (drift hors migration :
-- aucun `TO anon` n'existe dans supabase/migrations/).
--
-- REPRODUCTION (prod, 2026-08-28, lecture seule)
--   rôle anon (clé publique, AUCUNE connexion) :
--     properties            →  0 ligne   (la table est bien protégée)
--     properties_enriched   → 99 lignes  (la vue ne l'est pas)
--       dont  8 biens avec propria_bank_rib / propria_bank_iban
--            17 biens avec propria_owner_phone / propria_owner_email
--            16 biens avec propria_lock_code / propria_key_box_* / elevator_code
--            16 biens avec propria_wifi_password
--            96 biens avec price
--     v_bank_account_current_balance → 2 comptes bancaires
--     stoniz_wallet_balances         → 4 caisses
--     stoniz_project_cash_pl         → 12 P&L projets
--   vrai compte 'client' de prod :
--     properties → 2 biens (correct) | properties_enriched → 99 biens
--
-- FIX
-- `security_invoker = on` sur les 13 vues + retrait du GRANT à anon
-- (défense en profondeur : l'option seule suffit déjà à rendre anon aveugle).
--
-- NON-RÉGRESSION — vérifiée avant écriture, pas supposée
--  1. service_role a rolbypassrls = true → AUCUN impact sur les lectures
--     serveur : crons (app/api/cron/*), briefs (lib/reports/brief-*.ts),
--     moteur d'alertes (lib/alerts/collect.ts), /upsell (page voyageur QR,
--     app/upsell/[slug]/page.tsx:16 → createAdminClient).
--  2. Aucun composant navigateur ('use client') ne lit ces vues.
--  3. Le portail client app/(client)/** n'en lit AUCUNE.
--  4. Aucune de ces 13 vues n'est lue par une autre vue (pg_depend vérifié).
--  5. Toutes les tables sources sont couvertes, pour chaque rôle atteignant
--     l'écran, par une policy SELECT au moins aussi large que la vue.
--     Test réel rôle 'marketing' en prod : properties 394/394, property_media
--     651/651, profiles 66/66, propria_units 110/110, propria_cleanings
--     768/768, propria_interventions 270/270 → zéro ligne perdue.
--
-- SEUL CHANGEMENT DE COMPORTEMENT ATTENDU
--   properties_publication_status.partner_name devient NULL pour les rôles
--   'finance' et 'marketing' (partners_read_staff ne les inclut pas ; testé :
--   0 partenaire visible sur 74). LEFT JOIN → aucune ligne perdue. Aucun écran
--   ouvert à ces 2 rôles ne sélectionne cette colonne aujourd'hui
--   (/properties et /properties/[id] ne lisent que is_published,
--   step2_sourcing_done, step3_media_done, published_at,
--   missing_for_publication). Élargir partners_read_staff est une décision
--   métier distincte, hors périmètre de cette migration.
--
-- APPLIQUEE EN PROD le 2026-08-28 (nom cote base : 
--   fix_views_security_invoker_and_anon_grants).
-- VERIFICATION POST-APPLICATION, comptes reels de prod :
--   anon   -> 'permission denied for view properties_enriched' (fuite fermee)
--   client -> properties 2 (inchange) / properties_enriched 0 (etait 99)
--             comptes bancaires 0, caisses 0, P&L 0 (etaient 2 / 4 / 12)
--   ceo, finance, propria, sourcing, marketing, menage -> comptages
--             IDENTIQUES a l'avant sur toutes leurs vues : aucun ecran vide.
--   menage -> perd en prime l'acces aux soldes bancaires et aux caisses
--             (0 au lieu de 2 et 4) : effet de bord souhaite.
--   Seul ecart de comportement, conforme a la prevision : partner_name
--   = NULL pour finance et marketing sur properties_publication_status
--   (0/58 au lieu de 58/58). Aucune ligne perdue (LEFT JOIN), aucun ecran
--   ouvert a ces 2 roles n'affiche cette colonne aujourd'hui.
--   (chasseur_name est NULL pour TOUS les roles, CEO inclus : la colonne
--   assigned_chasseur n'est pas renseignee. Ce n'est pas une regression.)
-- ROLLBACK : scripts/sql/rollback_20260828120000_views_security_invoker.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) La vue applique désormais les droits de celui qui l'interroge ──────────
--    (idempotent : ALTER ... SET sur une option déjà posée est sans effet)
ALTER VIEW public.properties_enriched                    SET (security_invoker = on);
ALTER VIEW public.properties_publication_status          SET (security_invoker = on);
ALTER VIEW public.v_property_completeness                SET (security_invoker = on);
ALTER VIEW public.v_property_propria_kpis                SET (security_invoker = on);
ALTER VIEW public.artisans_completeness                  SET (security_invoker = on);
ALTER VIEW public.v_bank_account_current_balance         SET (security_invoker = on);
ALTER VIEW public.stoniz_wallet_balances                 SET (security_invoker = on);
ALTER VIEW public.stoniz_project_cash_pl                 SET (security_invoker = on);
ALTER VIEW public.propria_wallet_balances                SET (security_invoker = on);
ALTER VIEW public.propria_interventions_enriched         SET (security_invoker = on);
ALTER VIEW public.propria_cleanings_enriched             SET (security_invoker = on);
ALTER VIEW public.v_propria_unit_completeness            SET (security_invoker = on);
ALTER VIEW public.v_propria_listing_monthly_performance  SET (security_invoker = on);

-- 2) Plus aucune lecture publique non authentifiée ─────────────────────────
--    'authenticated' et 'service_role' conservent leur SELECT.
REVOKE SELECT ON public.properties_enriched                    FROM anon;
REVOKE SELECT ON public.properties_publication_status          FROM anon;
REVOKE SELECT ON public.v_property_completeness                FROM anon;
REVOKE SELECT ON public.v_property_propria_kpis                FROM anon;
REVOKE SELECT ON public.artisans_completeness                  FROM anon;
REVOKE SELECT ON public.v_bank_account_current_balance         FROM anon;
REVOKE SELECT ON public.stoniz_wallet_balances                 FROM anon;
REVOKE SELECT ON public.stoniz_project_cash_pl                 FROM anon;
REVOKE SELECT ON public.propria_wallet_balances                FROM anon;
REVOKE SELECT ON public.propria_interventions_enriched         FROM anon;
REVOKE SELECT ON public.propria_cleanings_enriched             FROM anon;
REVOKE SELECT ON public.v_propria_unit_completeness            FROM anon;
REVOKE SELECT ON public.v_propria_listing_monthly_performance  FROM anon;

-- 3) Trace de la règle, pour que la prochaine vue ne reparte pas de zéro ───
COMMENT ON VIEW public.properties_enriched IS
  'RLS : security_invoker = on OBLIGATOIRE (contre-audit 2026-08-28). Expose des colonnes sensibles de properties (RIB/IBAN, codes d''accès, mots de passe wifi) : ne JAMAIS accorder SELECT à anon.';
COMMENT ON VIEW public.v_bank_account_current_balance IS
  'RLS : security_invoker = on OBLIGATOIRE (contre-audit 2026-08-28). Soldes bancaires réels : lecture réservée à ceo/finance/developer via les policies tresorerie_select.';

COMMIT;

-- PostgREST doit relire le schéma, sinon les filtres sur ces vues peuvent
-- être ignorés silencieusement (même précaution que 20260611120000 et
-- 20260612150000).
NOTIFY pgrst, 'reload schema';
