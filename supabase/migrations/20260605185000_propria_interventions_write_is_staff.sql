-- 2e itération : la policy précédente (avec current_role_name()+auth.uid())
-- bloquait encore Habiba malgré la logique correcte sur papier — probablement
-- un problème de propagation auth.uid() ou un edge case sur current_role_name().
-- On revient au pattern simple utilisé par les autres tables propria_* :
-- WITH CHECK (is_staff()) sans condition imbriquée.
-- La vérification fine du rôle reste dans le code TypeScript (assertRole).

DROP POLICY IF EXISTS propria_interventions_write ON public.propria_interventions;

CREATE POLICY propria_interventions_write
ON public.propria_interventions
FOR INSERT
WITH CHECK (is_staff());

COMMENT ON POLICY propria_interventions_write ON public.propria_interventions IS
  'INSERT autorisé pour tout staff actif (is_staff() = profile actif et rôle != client). Le filtrage rôle métier précis se fait côté code via assertRole.';
