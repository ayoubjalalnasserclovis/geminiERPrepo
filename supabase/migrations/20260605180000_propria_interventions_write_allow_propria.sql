-- Bug capté en prod le 2026-06-05 via app_error_logs : Habiba (rôle propria)
-- ne pouvait pas créer d'intervention parce que la policy INSERT excluait
-- explicitement le rôle propria, alors que l'action TypeScript autorisait
-- ['ceo','assistante','propria']. On aligne la BDD sur le comportement
-- applicatif : un propria peut créer une intervention qu'il signe lui-même.

DROP POLICY IF EXISTS propria_interventions_write ON public.propria_interventions;

CREATE POLICY propria_interventions_write
ON public.propria_interventions
FOR INSERT
WITH CHECK (
  -- Cas back-office (CEO, chef_projet, assistante, finance, developer…)
  (is_staff() AND current_role_name() <> 'propria')
  OR
  -- Cas terrain : un collaborateur Propria peut créer une intervention,
  -- à condition de la signer (created_by = lui).
  (current_role_name() = 'propria' AND created_by = auth.uid())
);

COMMENT ON POLICY propria_interventions_write ON public.propria_interventions IS
  'Back-office : free INSERT. Propria : INSERT autorisé uniquement si created_by = auth.uid() (le terrain crée ses propres tâches, pas celles des autres).';
