-- Décision CEO 2026-06-08 : n'importe quel propria peut piloter n'importe
-- quelle tâche propria (assignation, démarrage, soumission, dépôt de preuve).
-- L'équipe terrain s'organise librement. Seul le back-office valide/refuse.
--
-- On simplifie donc READ et UPDATE à `is_staff()` (tout staff actif, propria
-- compris), comme c'est déjà le cas pour INSERT depuis 2026-06-05.

DROP POLICY IF EXISTS propria_interventions_read ON public.propria_interventions;
CREATE POLICY propria_interventions_read
ON public.propria_interventions
FOR SELECT
USING (is_staff());

DROP POLICY IF EXISTS propria_interventions_update ON public.propria_interventions;
CREATE POLICY propria_interventions_update
ON public.propria_interventions
FOR UPDATE
USING (is_staff())
WITH CHECK (is_staff());

COMMENT ON POLICY propria_interventions_update ON public.propria_interventions IS
  'Toute personne staff active peut lire et modifier les interventions. Le filtrage métier précis (valider/refuser = back-office only) se fait côté Server Actions via assertRole.';

-- Idem pour les preuves : tout propria peut consulter et uploader sur
-- n'importe quelle intervention (avant : limité à l'assigné).
DROP POLICY IF EXISTS propria_intervention_proofs_read ON public.propria_intervention_proofs;
CREATE POLICY propria_intervention_proofs_read
ON public.propria_intervention_proofs
FOR SELECT
USING (is_staff());

DROP POLICY IF EXISTS propria_intervention_proofs_insert ON public.propria_intervention_proofs;
CREATE POLICY propria_intervention_proofs_insert
ON public.propria_intervention_proofs
FOR INSERT
WITH CHECK (is_staff());
