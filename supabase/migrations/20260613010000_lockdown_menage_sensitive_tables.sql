-- ════════════════════════════════════════════════════════════════════════════
-- QA-BUG-011 (S2) — Verrouillage base du rôle menage sur tables sensibles
--
-- Constat (test RLS direct, 12 rôles) : le rôle menage (femme/homme de ménage,
-- UI limitée à /propria/menage) lisait via l'API toute la base équipe car les
-- policies de lecture utilisent `is_staff()` (vrai pour tout rôle ≠ client) :
--   payments 201 · clients 65 · projects 72 · documents 274.
-- L'écran le cache, mais un token menage + appel REST direct voyait tout.
-- Décision CEO 2026-06-12 : verrouiller la base.
--
-- Approche chirurgicale : on remplace le `is_staff()` (sans argument) des
-- policies de LECTURE de ces 4 tables sensibles par la liste explicite de tous
-- les rôles staff SAUF menage. On ne touche PAS aux tables Propria dont menage
-- a légitimement besoin (cleanings, units, interventions, litiges, properties,
-- hostaway_*, comments) — son métier reste intact. travaux_*/achats_*/
-- stoniz_wallet_* excluaient déjà menage (liste de rôles figée).
-- ════════════════════════════════════════════════════════════════════════════

-- Liste = tout le staff sauf menage (et sauf client, déjà hors is_staff)
-- ceo, chef_projet, sourcing, commercial, finance, marketing, assistante,
-- propria, developer, achats

-- ── payments : lecture staff (hors menage) ─────────────────────────────────
DROP POLICY IF EXISTS payments_staff_read ON public.payments;
CREATE POLICY payments_staff_read ON public.payments
  FOR SELECT USING (is_staff(ARRAY['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats']));

-- ── clients : lecture staff (hors menage) ──────────────────────────────────
DROP POLICY IF EXISTS clients_staff_read ON public.clients;
CREATE POLICY clients_staff_read ON public.clients
  FOR SELECT USING (is_staff(ARRAY['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats']));

-- ── projects : lecture staff (hors menage) ─────────────────────────────────
DROP POLICY IF EXISTS projects_staff_read ON public.projects;
CREATE POLICY projects_staff_read ON public.projects
  FOR SELECT USING (is_staff(ARRAY['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats']));

-- ── documents : accès staff (hors menage) ──────────────────────────────────
-- Policy ALL d'origine (is_staff()) scindée : on conserve un accès complet au
-- staff hors menage. Les policies client/artisan restent inchangées.
DROP POLICY IF EXISTS documents_staff_all ON public.documents;
CREATE POLICY documents_staff_all ON public.documents
  FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats']));
