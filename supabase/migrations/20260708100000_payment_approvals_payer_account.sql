-- ============================================================================
-- Compte payeur sur les demandes de virement achats / travaux (CEO 2026-07-08).
--
-- Le demandeur choisit OBLIGATOIREMENT depuis quel compte le virement sera
-- émis : compte personnel OU compte société STZ OJ. Obligation portée par la
-- validation Zod côté server actions (achats + travaux uniquement) — la
-- colonne reste nullable en BDD car :
--   • les demandes historiques n'ont pas cette info (pas de backfill inventé)
--   • les demandes d'honoraires Stoniz (payment_id) ne sont pas concernées
-- ============================================================================

ALTER TABLE payment_approvals
  ADD COLUMN IF NOT EXISTS payer_account TEXT
  CHECK (payer_account IN ('personnel', 'stz_oj'));

COMMENT ON COLUMN payment_approvals.payer_account IS
  'Compte émetteur du virement choisi par le demandeur : personnel | stz_oj. Obligatoire (Zod) pour les demandes achats/travaux, NULL pour honoraires + historique.';
