-- Cf migration prod : kanbans avis post + pré (CEO 2026-06-10).

ALTER TABLE public.hostaway_reviews
  ADD COLUMN IF NOT EXISTS kanban_column text NOT NULL DEFAULT 'a_traiter'
    CHECK (kanban_column IN ('a_traiter','ticket1_ouvert','ticket1_non_resolu','ticket2_ouvert','gagne','perdu')),
  ADD COLUMN IF NOT EXISTS ticket1_opened_at date,
  ADD COLUMN IF NOT EXISTS ticket1_unresolved_at date,
  ADD COLUMN IF NOT EXISTS ticket2_opened_at date,
  ADD COLUMN IF NOT EXISTS won_at date,
  ADD COLUMN IF NOT EXISTS lost_at date;

CREATE INDEX IF NOT EXISTS idx_hostaway_reviews_kanban_col
  ON public.hostaway_reviews(kanban_column) WHERE deleted_at IS NULL;

UPDATE public.hostaway_reviews
SET kanban_column = 'gagne', won_at = COALESCE(removed_at::date, current_date)
WHERE removed_at IS NOT NULL AND kanban_column = 'a_traiter';

CREATE TABLE IF NOT EXISTS public.hostaway_pre_review_tracking (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostaway_reservation_id bigint NOT NULL UNIQUE,
  hostaway_listing_db_id  uuid REFERENCES public.hostaway_listings(id) ON DELETE SET NULL,
  propria_unit_id         uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,
  sentiment               text CHECK (sentiment IN ('bon','neutre','mauvais')),
  sentiment_set_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sentiment_set_at        timestamptz,
  kanban_status           text NOT NULL DEFAULT 'nouveau'
    CHECK (kanban_status IN ('nouveau','risque','bon','action_lancee','accomplie','ratee')),
  related_review_id       uuid REFERENCES public.hostaway_reviews(id) ON DELETE SET NULL,
  completed_at            timestamptz,
  completion_reason       text,
  internal_notes          text,
  assignee_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pre_review_status    ON public.hostaway_pre_review_tracking(kanban_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pre_review_sentiment ON public.hostaway_pre_review_tracking(sentiment) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pre_review_unit      ON public.hostaway_pre_review_tracking(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pre_review_assignee  ON public.hostaway_pre_review_tracking(assignee_id) WHERE deleted_at IS NULL;

ALTER TABLE public.hostaway_pre_review_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read pre_review"   ON public.hostaway_pre_review_tracking;
DROP POLICY IF EXISTS "staff insert pre_review" ON public.hostaway_pre_review_tracking;
DROP POLICY IF EXISTS "staff update pre_review" ON public.hostaway_pre_review_tracking;
DROP POLICY IF EXISTS "staff delete pre_review" ON public.hostaway_pre_review_tracking;
CREATE POLICY "staff read pre_review"   ON public.hostaway_pre_review_tracking FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert pre_review" ON public.hostaway_pre_review_tracking FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update pre_review" ON public.hostaway_pre_review_tracking FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete pre_review" ON public.hostaway_pre_review_tracking FOR DELETE USING (public.is_staff());

CREATE TABLE IF NOT EXISTS public.hostaway_pre_review_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id   uuid NOT NULL REFERENCES public.hostaway_pre_review_tracking(id) ON DELETE CASCADE,
  action_type   text NOT NULL CHECK (action_type IN ('compensation','message','appel','geste_commercial','relance_positive','autre')),
  description   text,
  amount        numeric,
  currency      text DEFAULT 'MAD',
  performed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pre_review_actions_tracking
  ON public.hostaway_pre_review_actions(tracking_id) WHERE deleted_at IS NULL;

ALTER TABLE public.hostaway_pre_review_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read pre_review_act"   ON public.hostaway_pre_review_actions;
DROP POLICY IF EXISTS "staff insert pre_review_act" ON public.hostaway_pre_review_actions;
DROP POLICY IF EXISTS "staff update pre_review_act" ON public.hostaway_pre_review_actions;
DROP POLICY IF EXISTS "staff delete pre_review_act" ON public.hostaway_pre_review_actions;
CREATE POLICY "staff read pre_review_act"   ON public.hostaway_pre_review_actions FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert pre_review_act" ON public.hostaway_pre_review_actions FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update pre_review_act" ON public.hostaway_pre_review_actions FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete pre_review_act" ON public.hostaway_pre_review_actions FOR DELETE USING (public.is_staff());

NOTIFY pgrst, 'reload schema';
