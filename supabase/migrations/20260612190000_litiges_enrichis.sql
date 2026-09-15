-- ─── Chantier 6 marathon (U11 + décisions CEO B4/B5) — Litiges enrichis ─────
--
-- 1. Nouveau type de litige 'menage' (litige causé par un ménage raté).
-- 2. Décision B4 : un litige contient N lignes (propria_litige_items) —
--    ex : table cassée + TV disparue dans le même dossier. Coût réel Stoniz
--    vs montant demandé à AirCover/voyageur, facture + photos PAR LIGNE.
--    Totaux DÉRIVÉS (vue propria_litiges_totals), jamais stockés.
--    propria_litiges.amount devient LEGACY (lecture seule, plus écrit).
-- 3. N° dossier AirCover (aircover_reference) sur le litige.
-- 4. Décision B5 : table de commentaires UNIQUE propria_comments partagée
--    entre litiges, avis et incidents (fil chronologique + mentions @).
--
-- Idempotent : IF NOT EXISTS / WHERE NOT EXISTS partout, re-run sans effet.

-- ─── 1) Type 'menage' ────────────────────────────────────────────────────
ALTER TABLE public.propria_litiges
  DROP CONSTRAINT IF EXISTS propria_litiges_type_check;
ALTER TABLE public.propria_litiges
  ADD CONSTRAINT propria_litiges_type_check
  CHECK (type IN ('caution','degats','frais_contestes','annulation_tardive','tapage','menage','autre'));

-- ─── 2) N° dossier AirCover + dépréciation de amount ────────────────────
ALTER TABLE public.propria_litiges
  ADD COLUMN IF NOT EXISTS aircover_reference text;

COMMENT ON COLUMN public.propria_litiges.aircover_reference IS
  'N° de dossier AirCover/Airbnb (saisie libre, chantier 6 marathon).';

COMMENT ON COLUMN public.propria_litiges.amount IS
  'DÉPRÉCIÉ (chantier 6 marathon, décision B4) — remplacé par les lignes propria_litige_items (amount_claimed_mad). Conservé pour audit/lecture legacy, NE PLUS ÉCRIRE depuis le code.';

-- ─── 3) Lignes de litige (décision B4 — multi-éléments, tout en MAD) ─────
CREATE TABLE IF NOT EXISTS public.propria_litige_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  litige_id          uuid NOT NULL REFERENCES public.propria_litiges(id) ON DELETE CASCADE,
  description        text NOT NULL,
  cost_real_mad      numeric,      -- coût réel supporté par Stoniz (remplacement/réparation)
  amount_claimed_mad numeric,      -- montant demandé à AirCover / au voyageur
  invoice_path       text,         -- facture (bucket documents, propria-litiges/<litige_id>/items/…)
  photo_paths        text[] NOT NULL DEFAULT '{}',
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_litige_items_litige
  ON public.propria_litige_items(litige_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_litige_items_updated_at ON public.propria_litige_items;
CREATE TRIGGER propria_litige_items_updated_at
  BEFORE UPDATE ON public.propria_litige_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.propria_litige_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read litige_items"    ON public.propria_litige_items;
DROP POLICY IF EXISTS "ops insert litige_items"    ON public.propria_litige_items;
DROP POLICY IF EXISTS "ops update litige_items"    ON public.propria_litige_items;
DROP POLICY IF EXISTS "ops delete litige_items"    ON public.propria_litige_items;
CREATE POLICY "staff read litige_items" ON public.propria_litige_items
  FOR SELECT USING (public.is_staff());
CREATE POLICY "ops insert litige_items" ON public.propria_litige_items
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ops update litige_items" ON public.propria_litige_items
  FOR UPDATE USING (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ops delete litige_items" ON public.propria_litige_items
  FOR DELETE USING (public.is_staff(ARRAY['ceo','assistante','propria']));

-- Backfill : chaque litige existant (montant et/ou description saisis) devient
-- 1 ligne. IDEMPOTENT : on ne ré-insère pas si le litige a déjà des items.
INSERT INTO public.propria_litige_items
  (litige_id, description, amount_claimed_mad, created_by, created_at)
SELECT
  l.id,
  COALESCE(NULLIF(trim(l.description), ''), 'Litige ' || l.type),
  l.amount,
  l.created_by,
  l.created_at
FROM public.propria_litiges l
WHERE l.deleted_at IS NULL
  AND (l.amount IS NOT NULL OR NULLIF(trim(l.description), '') IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.propria_litige_items i WHERE i.litige_id = l.id
  );

-- ─── 4) Totaux dérivés (convention n°1 : jamais stockés) ─────────────────
CREATE OR REPLACE VIEW public.propria_litiges_totals AS
SELECT
  l.id                                            AS litige_id,
  COUNT(i.id)                                     AS nb_items,
  COALESCE(SUM(i.cost_real_mad), 0)               AS total_cost_real_mad,
  COALESCE(SUM(i.amount_claimed_mad), 0)          AS total_claimed_mad,
  COALESCE(SUM(i.amount_claimed_mad), 0)
    - COALESCE(SUM(i.cost_real_mad), 0)           AS marge_mad
FROM public.propria_litiges l
LEFT JOIN public.propria_litige_items i
  ON i.litige_id = l.id AND i.deleted_at IS NULL
WHERE l.deleted_at IS NULL
GROUP BY l.id;

ALTER VIEW public.propria_litiges_totals SET (security_invoker = on);

COMMENT ON VIEW public.propria_litiges_totals IS
  'Totaux dérivés par litige (somme des lignes propria_litige_items non supprimées). Source de vérité du montant d''un litige — propria_litiges.amount est déprécié.';

-- ─── 5) Commentaires partagés (décision B5 — table unique) ───────────────
CREATE TABLE IF NOT EXISTS public.propria_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('litige','avis','incident')),
  entity_id   uuid NOT NULL,
  body        text NOT NULL,
  author_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  mentions    uuid[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_propria_comments_entity
  ON public.propria_comments(entity_type, entity_id, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.propria_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read comments"   ON public.propria_comments;
DROP POLICY IF EXISTS "staff insert comments" ON public.propria_comments;
DROP POLICY IF EXISTS "ceo update comments"   ON public.propria_comments;
DROP POLICY IF EXISTS "ceo delete comments"   ON public.propria_comments;
CREATE POLICY "staff read comments" ON public.propria_comments
  FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert comments" ON public.propria_comments
  FOR INSERT WITH CHECK (public.is_staff() AND author_id = auth.uid());
CREATE POLICY "ceo update comments" ON public.propria_comments
  FOR UPDATE USING (public.is_staff(ARRAY['ceo']));
CREATE POLICY "ceo delete comments" ON public.propria_comments
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

COMMENT ON TABLE public.propria_comments IS
  'Commentaires internes partagés (décision B5) : une seule table pour litiges, avis Airbnb et incidents ménage. Soft-delete uniquement (deleted_at).';

NOTIFY pgrst, 'reload schema';
