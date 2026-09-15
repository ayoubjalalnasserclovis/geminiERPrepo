-- ─── Audit log centralisé Propria (CEO 2026-06-10) ───────────────────
-- Trace chaque mutation (create / update / delete) sur les tables Propria
-- pour pouvoir auditer "qui a fait quoi quand" sur chaque fiche détail.
--
-- Why : ouverture des permissions au rôle propria (Ismael, futurs renforts).
-- Le CEO veut garder la trace de toutes les modifications opérationnelles.
--
-- Le log est INSERT-only (pas d'UPDATE, pas de DELETE) — sécurité d'audit.
-- Visualisation : composant PropriaAuditTimeline en bas de chaque fiche.

CREATE TABLE IF NOT EXISTS public.propria_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN ('create','update','delete','restore','validate','status_change','assign','custom')),
  label       text,         -- libellé court humain : "Ajout d'un lot", "Validation paiement"
  payload     jsonb,        -- diff avant/après ou détail de l'action
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propria_audit_log_record
  ON public.propria_audit_log (table_name, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_propria_audit_log_actor
  ON public.propria_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_propria_audit_log_recent
  ON public.propria_audit_log (created_at DESC);

COMMENT ON TABLE public.propria_audit_log IS
  'Audit log centralisé Propria : trace chaque mutation par membre de l''équipe.
   INSERT-only (sécurité d''audit). Lu par PropriaAuditTimeline sur les fiches détail.';

ALTER TABLE public.propria_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read propria_audit_log"    ON public.propria_audit_log;
DROP POLICY IF EXISTS "staff insert propria_audit_log"  ON public.propria_audit_log;

-- Tout staff peut lire (transparence d'audit pour l'équipe Propria).
CREATE POLICY "staff read propria_audit_log"
  ON public.propria_audit_log FOR SELECT
  USING (public.is_staff());

-- Tout staff peut insérer (les actions sont déjà gated côté server actions).
CREATE POLICY "staff insert propria_audit_log"
  ON public.propria_audit_log FOR INSERT
  WITH CHECK (public.is_staff());

-- Volontairement PAS de policy UPDATE/DELETE : l'audit est immuable.

NOTIFY pgrst, 'reload schema';
