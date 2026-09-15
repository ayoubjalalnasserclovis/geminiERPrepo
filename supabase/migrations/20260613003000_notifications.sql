-- ─────────────────────────────────────────────────────────────────────────
-- Notifications in-app (CEO 2026-06-12)
--
-- Demande : « si on tag quelqu'un (mention @) ou autre, ça s'affiche dans
-- l'app » + mail sur mention. Une table générique `propria_notifications`
-- alimentée par les server actions (mentions de commentaires, assignations
-- interventions / litiges / avis). Lecture via la cloche du layout équipe.
--
-- Conventions respectées :
--   • soft-delete uniquement (deleted_at), jamais de hard-delete
--   • RLS strict : chacun ne lit que SES notifications (le CEO voit tout)
--   • kind extensible via CHECK (mention / assignation / autre)
-- Idempotent : IF NOT EXISTS + DROP POLICY IF EXISTS, rejouable sans effet.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.propria_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Destinataire de la notification (jamais l'auteur lui-même, exclu côté code)
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Type d'événement — extensible : ajouter une valeur au CHECK si besoin
  kind        text NOT NULL CHECK (kind IN ('mention','assignation','autre')),
  title       text NOT NULL,
  body        text,
  -- Lien interne app (ex: /propria/litiges, /propria/avis?review=<id>)
  href        text,
  -- Auteur de l'événement déclencheur (mentionneur, assigneur…)
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE public.propria_notifications IS
  'Notifications in-app (CEO 2026-06-12) : mentions @ dans les commentaires, assignations interventions/litiges/avis. Affichées dans la cloche du layout équipe. Soft-delete uniquement (deleted_at).';
COMMENT ON COLUMN public.propria_notifications.user_id IS
  'Destinataire — la RLS SELECT garantit que chacun ne lit que les siennes (CEO voit tout).';
COMMENT ON COLUMN public.propria_notifications.kind IS
  'Type : mention (commentaire @), assignation (intervention/litige/avis), autre. Extensible via le CHECK.';
COMMENT ON COLUMN public.propria_notifications.href IS
  'Lien interne de destination au clic sur la notification (chemin relatif app).';
COMMENT ON COLUMN public.propria_notifications.created_by IS
  'Auteur de l''événement déclencheur (profil staff). NULL si profil supprimé.';
COMMENT ON COLUMN public.propria_notifications.read_at IS
  'NULL = non lue. Renseigné par le destinataire (markRead / markAllRead).';

-- Index de lecture de la cloche : « mes notifications, non-lues d'abord,
-- récentes d'abord » — partiel sur les lignes vivantes uniquement.
CREATE INDEX IF NOT EXISTS idx_propria_notifications_user_read
  ON public.propria_notifications (user_id, read_at, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.propria_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own or ceo read notifications"  ON public.propria_notifications;
DROP POLICY IF EXISTS "own update notifications"       ON public.propria_notifications;
DROP POLICY IF EXISTS "staff insert notifications"     ON public.propria_notifications;
DROP POLICY IF EXISTS "ceo delete notifications"       ON public.propria_notifications;

-- Lecture : le destinataire uniquement (le CEO peut tout auditer)
CREATE POLICY "own or ceo read notifications" ON public.propria_notifications
  FOR SELECT USING (user_id = auth.uid() OR public.is_staff(ARRAY['ceo']));

-- Mise à jour : le destinataire seul (marquer lu / non-lu)
CREATE POLICY "own update notifications" ON public.propria_notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Insertion : tout staff actif, mais toujours signée de l'auteur réel
CREATE POLICY "staff insert notifications" ON public.propria_notifications
  FOR INSERT WITH CHECK (public.is_staff() AND created_by = auth.uid());

-- Suppression dure : CEO uniquement (le flux normal reste le soft-delete)
CREATE POLICY "ceo delete notifications" ON public.propria_notifications
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

NOTIFY pgrst, 'reload schema';
