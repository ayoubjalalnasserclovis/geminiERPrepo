-- ============================================================================
-- Échéancier honoraires éditable par le CEO + source unique pour les dashboards
-- ----------------------------------------------------------------------------
-- Contexte métier :
--   • Les honoraires Stoniz sont les 5 échéances de la table `payments`
--     (acompte_stoniz + honoraires_compromis/3d/chantier/livraison).
--   • Ces échéances sont créées AU FIL DES ÉVÉNEMENTS (modèle événementiel
--     introduit par 20260527006000_payments_event_driven.sql). On NE pré-crée
--     rien : ce fichier ne touche pas à ce mécanisme.
--   • Décision CEO : ces échéances deviennent la SOURCE UNIQUE des honoraires.
--     Le total par projet n'est jamais stocké : il est dérivé (vue ci-dessous),
--     conforme au canon "aucun calcul stocké en dur".
--
-- Ce que fait cette migration (idempotente, DDL pure, aucune écriture de data) :
--   1. Ajoute `payments.label` : libellé personnalisé d'une échéance
--      (NULL = on retombe sur le libellé standard du barème côté applicatif).
--   2. Crée la vue `project_honoraires_totals` : total attendu / encaissé des
--      honoraires par projet, dérivé des échéances (hors type 'autre').
-- ============================================================================

-- ─── 1. Libellé personnalisable d'une échéance ──────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS label TEXT;

COMMENT ON COLUMN payments.label IS
  'Libellé personnalisé de l''échéance (saisi par le CEO). NULL = libellé standard du barème (voir lib/finance/stoniz-fees.ts).';

-- ─── 2. Vue dérivée : total honoraires par projet (source unique dashboards) ─
-- security_invoker = on : la vue respecte les RLS de `payments`
-- (le lecteur doit déjà avoir le droit de lire les paiements du projet).
CREATE OR REPLACE VIEW project_honoraires_totals
  WITH (security_invoker = on) AS
SELECT
  p.project_id,
  COALESCE(SUM(p.amount_expected), 0) AS honoraires_expected,
  COALESCE(SUM(p.amount_paid), 0)     AS honoraires_paid
FROM payments p
WHERE p.deleted_at IS NULL
  AND p.type <> 'autre'
GROUP BY p.project_id;

COMMENT ON VIEW project_honoraires_totals IS
  'Total honoraires Stoniz par projet, dérivé des échéances (payments hors type autre). Source unique des honoraires pour les dashboards. Jamais stocké.';
