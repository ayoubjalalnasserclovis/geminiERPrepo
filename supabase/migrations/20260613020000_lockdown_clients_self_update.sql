-- QA-BUG-010 (décision CEO 2026-06-13) : retrait de clients_self_update.
-- Aucun flux client ne met à jour la table clients via le user client :
-- l'onboarding (seul writer) passe par le service_role (admin). La policy
-- ouvrait inutilement la modification de données déclaratives sensibles
-- (available_savings, budget_max…) par le client via l'API REST. Lecture
-- conservée (clients_self_read). Vérifié : update client = 0 ligne, read = OK.
DROP POLICY IF EXISTS clients_self_update ON public.clients;
