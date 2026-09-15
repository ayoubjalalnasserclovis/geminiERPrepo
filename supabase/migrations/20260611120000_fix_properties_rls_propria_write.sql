-- Fix bug "saisie bancaire disparait" pour le role propria (CEO 2026-06-11).
--
-- Cause : la policy 'properties_staff_all' avait :
--   USING  = is_staff() (tous staff lisent)
--   CHECK  = is_staff(ARRAY['ceo','chef_projet','sourcing'])  <-- propria exclu !
-- => UPDATE par 'propria' rejete silencieusement par WITH CHECK, la saisie
-- semblait reussir cote UI puis revenait vide au rechargement.
--
-- Fix : etendre la liste autorisee a 'propria','assistante','developer'.
-- Cote securite metier : l'updatePropriaPropertyAction filtre deja les
-- champs autorises via Zod, donc propria ne peut modifier que les champs
-- propria_* (pas les champs sourcing/travaux).

DROP POLICY IF EXISTS properties_staff_all ON public.properties;
CREATE POLICY properties_staff_all ON public.properties
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff(ARRAY['ceo','chef_projet','sourcing','propria','assistante','developer']::text[]));

NOTIFY pgrst, 'reload schema';
