-- QA-BUG-031 (étendu) — VERSIONNE les policies RLS du rôle `achats` qui existaient
-- en PROD mais étaient ABSENTES des migrations (drift repo↔prod). Rejouées à
-- l'identique (DROP IF EXISTS + CREATE) → AUCUN changement de comportement, on
-- capture seulement l'état prod dans le code pour qu'une reconstruction depuis
-- les migrations redonne au rôle achats ses accès.
--
-- NB : l'expression `(SELECT role FROM profiles WHERE id = auth.uid()) = 'achats'`
-- reproduit la prod telle quelle (sans contrôle is_active — voir note QA-BUG-031).

-- ── Lectures « transverses » du rôle achats (redondantes avec *_staff_read mais présentes en prod) ──
DROP POLICY IF EXISTS achats_read_clients ON public.clients;
CREATE POLICY achats_read_clients ON public.clients FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');

DROP POLICY IF EXISTS achats_read_projects ON public.projects;
CREATE POLICY achats_read_projects ON public.projects FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats' AND deleted_at IS NULL);

DROP POLICY IF EXISTS achats_read_properties ON public.properties;
CREATE POLICY achats_read_properties ON public.properties FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');

-- ── Accès FONCTIONNELS du rôle achats au module achats (lecture + saisie) ──
DROP POLICY IF EXISTS achats_read_achats_encaissements ON public.achats_encaissements;
CREATE POLICY achats_read_achats_encaissements ON public.achats_encaissements FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');

DROP POLICY IF EXISTS achats_read_achats_lots ON public.achats_lots;
CREATE POLICY achats_read_achats_lots ON public.achats_lots FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
DROP POLICY IF EXISTS achats_update_achats_lots ON public.achats_lots;
CREATE POLICY achats_update_achats_lots ON public.achats_lots FOR UPDATE
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
DROP POLICY IF EXISTS achats_write_achats_lots ON public.achats_lots;
CREATE POLICY achats_write_achats_lots ON public.achats_lots FOR INSERT
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');

DROP POLICY IF EXISTS achats_read_achats_payments ON public.achats_payments;
CREATE POLICY achats_read_achats_payments ON public.achats_payments FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
DROP POLICY IF EXISTS achats_update_achats_payments ON public.achats_payments;
CREATE POLICY achats_update_achats_payments ON public.achats_payments FOR UPDATE
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
DROP POLICY IF EXISTS achats_write_achats_payments ON public.achats_payments;
CREATE POLICY achats_write_achats_payments ON public.achats_payments FOR INSERT
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'achats');
