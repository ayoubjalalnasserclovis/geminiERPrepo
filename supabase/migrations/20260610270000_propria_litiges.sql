-- Module Litiges Airbnb (CEO 2026-06-10).
-- Kanban dédié pour gérer les contestations proactives (caution, dégâts,
-- frais contestés…) liées à une réservation Hostaway.

CREATE TABLE IF NOT EXISTS public.propria_litiges (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostaway_reservation_id bigint NOT NULL,
  hostaway_listing_db_id  uuid REFERENCES public.hostaway_listings(id) ON DELETE SET NULL,
  propria_unit_id         uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,
  type                    text NOT NULL CHECK (type IN ('caution','degats','frais_contestes','annulation_tardive','tapage','autre')),
  description             text,
  amount                  numeric,
  currency                text DEFAULT 'MAD',
  kanban_column           text NOT NULL DEFAULT 'ouvrir_ticket'
    CHECK (kanban_column IN ('ouvrir_ticket','ticket_ouvert','appel','gagne','perdu')),
  ticket_opened_at        date,
  call_started_at         date,
  won_at                  date,
  lost_at                 date,
  opened_at               date NOT NULL DEFAULT current_date,
  assignee_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  internal_notes          text,
  attachment_path         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_litiges_resa     ON public.propria_litiges(hostaway_reservation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_litiges_unit     ON public.propria_litiges(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_litiges_status   ON public.propria_litiges(kanban_column) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_litiges_assignee ON public.propria_litiges(assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_litiges_type     ON public.propria_litiges(type) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_litiges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read litiges"   ON public.propria_litiges;
DROP POLICY IF EXISTS "staff insert litiges" ON public.propria_litiges;
DROP POLICY IF EXISTS "staff update litiges" ON public.propria_litiges;
DROP POLICY IF EXISTS "staff delete litiges" ON public.propria_litiges;
CREATE POLICY "staff read litiges"   ON public.propria_litiges FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert litiges" ON public.propria_litiges FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update litiges" ON public.propria_litiges FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete litiges" ON public.propria_litiges FOR DELETE USING (public.is_staff());

CREATE TABLE IF NOT EXISTS public.propria_litiges_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  litige_id     uuid NOT NULL REFERENCES public.propria_litiges(id) ON DELETE CASCADE,
  action_type   text NOT NULL CHECK (action_type IN ('ouverture_ticket','appel','message','escalade','reponse_airbnb','autre')),
  description   text,
  performed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_litiges_actions_litige
  ON public.propria_litiges_actions(litige_id) WHERE deleted_at IS NULL;

ALTER TABLE public.propria_litiges_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read litiges_act"   ON public.propria_litiges_actions;
DROP POLICY IF EXISTS "staff insert litiges_act" ON public.propria_litiges_actions;
DROP POLICY IF EXISTS "staff update litiges_act" ON public.propria_litiges_actions;
DROP POLICY IF EXISTS "staff delete litiges_act" ON public.propria_litiges_actions;
CREATE POLICY "staff read litiges_act"   ON public.propria_litiges_actions FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert litiges_act" ON public.propria_litiges_actions FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update litiges_act" ON public.propria_litiges_actions FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete litiges_act" ON public.propria_litiges_actions FOR DELETE USING (public.is_staff());

NOTIFY pgrst, 'reload schema';
