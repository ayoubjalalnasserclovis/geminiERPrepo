-- ─── Rétro chantier 3 : tables inventaire chiffré + mesures (consultant CEO 2026-06-18) ───
--
-- Les tables propria_checkup_inventory et propria_checkup_measurements ont été
-- créées directement en prod via MCP lors du marathon chantier 3 — aucune
-- migration n'avait été commitée. Cette migration rétro RECONSTRUIT à
-- l'identique la prod pour qu'un environnement de dev / staging fraîchement
-- réinitialisé soit aligné.
--
-- Pattern :
--   • IF NOT EXISTS partout (idempotent vs prod déjà migrée)
--   • RLS « ALL true » (héritée de la prod, contrôle d'accès délégué aux
--     server actions via assertRole + helper is_staff côté propria_checkups)
--   • Trigger updated_at via propria_checkup_touch_updated_at (cohérent avec
--     prod, déclaré dans la migration chantier 3 originale jamais commitée)
--   • UNIQUE (checkup_id, item_key) → upsert avec onConflict ces 2 colonnes

-- Fonction touch (idempotente)
CREATE OR REPLACE FUNCTION public.propria_checkup_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ─── 1) Inventaire chiffré (linge, vaisselle, etc.) ───────────────────────
CREATE TABLE IF NOT EXISTS public.propria_checkup_inventory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkup_id    uuid NOT NULL REFERENCES public.propria_checkups(id) ON DELETE CASCADE,
  item_key      text NOT NULL,
  expected_qty  integer NOT NULL DEFAULT 6 CHECK (expected_qty >= 0),
  actual_qty    integer CHECK (actual_qty >= 0),
  missing_list  jsonb DEFAULT '[]'::jsonb,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- UNIQUE (cohérence upsert onConflict='checkup_id,item_key' côté action)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'propria_checkup_inventory_checkup_id_item_key_key'
  ) THEN
    ALTER TABLE public.propria_checkup_inventory
      ADD CONSTRAINT propria_checkup_inventory_checkup_id_item_key_key
      UNIQUE (checkup_id, item_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS propria_checkup_inventory_checkup_idx
  ON public.propria_checkup_inventory(checkup_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_checkup_inventory_touch ON public.propria_checkup_inventory;
CREATE TRIGGER propria_checkup_inventory_touch
  BEFORE UPDATE ON public.propria_checkup_inventory
  FOR EACH ROW EXECUTE FUNCTION public.propria_checkup_touch_updated_at();

ALTER TABLE public.propria_checkup_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS propria_checkup_inventory_all ON public.propria_checkup_inventory;
CREATE POLICY propria_checkup_inventory_all
  ON public.propria_checkup_inventory
  FOR ALL USING (true) WITH CHECK (true);

-- ─── 2) Mesures chiffrées (température, humidité, etc.) ──────────────────
CREATE TABLE IF NOT EXISTS public.propria_checkup_measurements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkup_id     uuid NOT NULL REFERENCES public.propria_checkups(id) ON DELETE CASCADE,
  item_key       text NOT NULL,
  value_numeric  numeric NOT NULL,
  unit           text NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'propria_checkup_measurements_checkup_id_item_key_key'
  ) THEN
    ALTER TABLE public.propria_checkup_measurements
      ADD CONSTRAINT propria_checkup_measurements_checkup_id_item_key_key
      UNIQUE (checkup_id, item_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS propria_checkup_measurements_checkup_idx
  ON public.propria_checkup_measurements(checkup_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_checkup_measurements_touch ON public.propria_checkup_measurements;
CREATE TRIGGER propria_checkup_measurements_touch
  BEFORE UPDATE ON public.propria_checkup_measurements
  FOR EACH ROW EXECUTE FUNCTION public.propria_checkup_touch_updated_at();

ALTER TABLE public.propria_checkup_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS propria_checkup_measurements_all ON public.propria_checkup_measurements;
CREATE POLICY propria_checkup_measurements_all
  ON public.propria_checkup_measurements
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.propria_checkup_inventory IS
  'Inventaire chiffré d''un check-up (chantier 3) — quantités attendues/observées + liste détaillée des manquants. Upsert par (checkup_id, item_key).';
COMMENT ON TABLE public.propria_checkup_measurements IS
  'Mesures chiffrées d''un check-up (chantier 3) — température, humidité, etc. Upsert par (checkup_id, item_key).';

NOTIFY pgrst, 'reload schema';
