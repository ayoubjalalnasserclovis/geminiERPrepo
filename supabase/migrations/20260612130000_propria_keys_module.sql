-- ─── Chantier 1 — Module Clés & Accès (marathon Propria, consultant U3) ──────
--
-- PRINCIPE (décision B1 du cadrage 2026-06-12) :
--   Un jeu de clés physique = UNE ligne dans propria_keys.
--   On ne saisit JAMAIS un comptage : on saisit un MOUVEMENT (propria_key_movements,
--   append-only). L'emplacement courant du jeu est maintenu par trigger depuis
--   les mouvements (chemin d'écriture unique). Les compteurs et alertes sont
--   DÉRIVÉS dans la vue propria_unit_keys_status.
--   L'ancien champ saisi propria_units.propria_nb_keys est DÉPRÉCIÉ (retiré des
--   écrans, conservé en BDD pour historique).
--
-- Seuils consultant : stock bureau ⚠ à 2 jeux / 🔴 à 1 ; armoire = 2 jeux de
-- réserve attendus ; cible 4 jeux par logement.
--
-- Historique des codes (clé sécurité, code serrure) : trigger → propria_audit_log
-- (table générique existante), pas de table dédiée.
--
-- Idempotent : rejouable sans erreur (branche Supabase puis prod au merge).

-- ─── 1. Clé sécurité : emplacement + code sur le lot ────────────────────────
ALTER TABLE public.propria_units
  ADD COLUMN IF NOT EXISTS propria_security_key_location text,
  ADD COLUMN IF NOT EXISTS propria_security_key_code text;

COMMENT ON COLUMN public.propria_units.propria_security_key_location IS
  'Emplacement de la clé sécurité (ex: coffre bureau, boîte scellée). Chantier 1 marathon.';
COMMENT ON COLUMN public.propria_units.propria_security_key_code IS
  'Code associé à la clé sécurité. Changements historisés dans propria_audit_log.';
COMMENT ON COLUMN public.propria_units.propria_nb_keys IS
  'DÉPRÉCIÉ (2026-06-12) — remplacé par le comptage dérivé de propria_keys. Ne plus afficher ni saisir.';

-- ─── 2. Jeux de clés physiques ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.propria_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propria_unit_id  uuid NOT NULL REFERENCES public.propria_units(id) ON DELETE CASCADE,
  key_number       integer NOT NULL,
  key_type         text NOT NULL DEFAULT 'reserve'
    CHECK (key_type IN ('voyageur','reserve','securite')),
  current_location text NOT NULL DEFAULT 'bureau'
    CHECK (current_location IN ('boite_voyageur','armoire_logement','bureau','externe','perdue')),
  label            text,
  notes            text,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.propria_keys IS
  'Un jeu de clés physique par ligne. current_location maintenu par trigger depuis propria_key_movements — ne jamais l''écrire directement.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_propria_keys_unit_number
  ON public.propria_keys(propria_unit_id, key_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_keys_unit
  ON public.propria_keys(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_keys_location
  ON public.propria_keys(current_location) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_keys_updated_at ON public.propria_keys;
CREATE TRIGGER propria_keys_updated_at
  BEFORE UPDATE ON public.propria_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Mouvements (append-only, source de vérité) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.propria_key_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id          uuid NOT NULL REFERENCES public.propria_keys(id) ON DELETE CASCADE,
  from_location   text,
  to_location     text NOT NULL
    CHECK (to_location IN ('boite_voyageur','armoire_logement','bureau','externe','perdue')),
  reason          text,
  cleaning_id     uuid REFERENCES public.propria_cleanings(id) ON DELETE SET NULL,
  intervention_id uuid REFERENCES public.propria_interventions(id) ON DELETE SET NULL,
  moved_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.propria_key_movements IS
  'Historique append-only des déplacements de jeux de clés. Pas d''UPDATE métier — correction = soft-delete + nouveau mouvement.';

CREATE INDEX IF NOT EXISTS idx_propria_key_movements_key
  ON public.propria_key_movements(key_id, created_at DESC) WHERE deleted_at IS NULL;

-- ─── 4. Trigger : un mouvement met à jour l'emplacement courant ─────────────
CREATE OR REPLACE FUNCTION public.propria_key_movement_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT current_location INTO v_current
  FROM public.propria_keys
  WHERE id = NEW.key_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jeu de clés introuvable ou supprimé (%)', NEW.key_id;
  END IF;

  IF NEW.from_location IS NULL THEN
    NEW.from_location := v_current;
  END IF;

  UPDATE public.propria_keys
  SET current_location = NEW.to_location, updated_at = now()
  WHERE id = NEW.key_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS propria_key_movements_apply ON public.propria_key_movements;
CREATE TRIGGER propria_key_movements_apply
  BEFORE INSERT ON public.propria_key_movements
  FOR EACH ROW EXECUTE FUNCTION public.propria_key_movement_apply();

-- ─── 5. Compteurs & alertes DÉRIVÉS ──────────────────────────────────────────
CREATE OR REPLACE VIEW public.propria_unit_keys_status
WITH (security_invoker = on) AS
SELECT
  u.id AS propria_unit_id,
  u.code,
  COUNT(k.id) FILTER (WHERE k.current_location <> 'perdue')          AS nb_total,
  COUNT(k.id) FILTER (WHERE k.current_location = 'boite_voyageur')   AS nb_boite_voyageur,
  COUNT(k.id) FILTER (WHERE k.current_location = 'armoire_logement') AS nb_armoire,
  COUNT(k.id) FILTER (WHERE k.current_location = 'bureau')           AS nb_bureau,
  COUNT(k.id) FILTER (WHERE k.current_location = 'externe')          AS nb_externe,
  COUNT(k.id) FILTER (WHERE k.current_location = 'perdue')           AS nb_perdues,
  (SELECT MAX(m.created_at)
     FROM public.propria_key_movements m
     JOIN public.propria_keys km ON km.id = m.key_id
    WHERE km.propria_unit_id = u.id AND m.deleted_at IS NULL)        AS last_movement_at,
  -- Seuils consultant : bureau 🔴 ≤1, ⚠ =2 ; armoire attendu ≥2 ; cible totale 4
  CASE
    WHEN COUNT(k.id) FILTER (WHERE k.current_location = 'bureau') <= 1 THEN 'critique'
    WHEN COUNT(k.id) FILTER (WHERE k.current_location = 'bureau') = 2 THEN 'warn'
    ELSE 'ok'
  END AS bureau_alert,
  CASE
    WHEN COUNT(k.id) FILTER (WHERE k.current_location = 'armoire_logement') < 2 THEN 'warn'
    ELSE 'ok'
  END AS armoire_alert,
  CASE
    WHEN COUNT(k.id) FILTER (WHERE k.current_location <> 'perdue') < 4 THEN 'warn'
    ELSE 'ok'
  END AS total_alert
FROM public.propria_units u
LEFT JOIN public.propria_keys k
  ON k.propria_unit_id = u.id AND k.deleted_at IS NULL
WHERE u.deleted_at IS NULL AND u.is_active
GROUP BY u.id, u.code;

COMMENT ON VIEW public.propria_unit_keys_status IS
  'Compteurs de clés par lot, 100 % dérivés des mouvements. Alertes : bureau (critique ≤1, warn =2), armoire (<2), total (<4 vs cible consultant).';

-- ─── 6. Historique des changements de codes → propria_audit_log ─────────────
CREATE OR REPLACE FUNCTION public.propria_units_log_code_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.propria_lock_code IS DISTINCT FROM NEW.propria_lock_code)
     OR (OLD.propria_security_key_code IS DISTINCT FROM NEW.propria_security_key_code)
     OR (OLD.propria_key_box_suite IS DISTINCT FROM NEW.propria_key_box_suite) THEN
    INSERT INTO public.propria_audit_log (table_name, record_id, actor_id, action, label, payload)
    VALUES (
      'propria_units', NEW.id, auth.uid(), 'custom',
      'Changement code accès / clé sécurité',
      jsonb_strip_nulls(jsonb_build_object(
        'kind', to_jsonb('code_change'::text),
        'lock_code',         CASE WHEN OLD.propria_lock_code IS DISTINCT FROM NEW.propria_lock_code
                             THEN jsonb_build_object('old', OLD.propria_lock_code, 'new', NEW.propria_lock_code) END,
        'security_key_code', CASE WHEN OLD.propria_security_key_code IS DISTINCT FROM NEW.propria_security_key_code
                             THEN jsonb_build_object('old', OLD.propria_security_key_code, 'new', NEW.propria_security_key_code) END,
        'key_box_suite',     CASE WHEN OLD.propria_key_box_suite IS DISTINCT FROM NEW.propria_key_box_suite
                             THEN jsonb_build_object('old', OLD.propria_key_box_suite, 'new', NEW.propria_key_box_suite) END
      ))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS propria_units_code_audit ON public.propria_units;
CREATE TRIGGER propria_units_code_audit
  AFTER UPDATE ON public.propria_units
  FOR EACH ROW EXECUTE FUNCTION public.propria_units_log_code_changes();

-- ─── 7. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.propria_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propria_key_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read keys"    ON public.propria_keys;
DROP POLICY IF EXISTS "staff insert keys"  ON public.propria_keys;
DROP POLICY IF EXISTS "staff update keys"  ON public.propria_keys;
DROP POLICY IF EXISTS "ceo delete keys"    ON public.propria_keys;
CREATE POLICY "staff read keys"   ON public.propria_keys FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert keys" ON public.propria_keys FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update keys" ON public.propria_keys FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "ceo delete keys"   ON public.propria_keys FOR DELETE USING (public.is_staff(ARRAY['ceo']));

DROP POLICY IF EXISTS "staff read key movements"   ON public.propria_key_movements;
DROP POLICY IF EXISTS "staff insert key movements" ON public.propria_key_movements;
DROP POLICY IF EXISTS "ceo update key movements"   ON public.propria_key_movements;
DROP POLICY IF EXISTS "ceo delete key movements"   ON public.propria_key_movements;
CREATE POLICY "staff read key movements"   ON public.propria_key_movements FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert key movements" ON public.propria_key_movements FOR INSERT WITH CHECK (public.is_staff());
-- UPDATE réservé CEO : seul cas légitime = soft-delete de correction
CREATE POLICY "ceo update key movements" ON public.propria_key_movements FOR UPDATE USING (public.is_staff(ARRAY['ceo'])) WITH CHECK (public.is_staff(ARRAY['ceo']));
CREATE POLICY "ceo delete key movements" ON public.propria_key_movements FOR DELETE USING (public.is_staff(ARRAY['ceo']));

-- Fonctions trigger SECURITY DEFINER : jamais appelables via l'API REST
REVOKE EXECUTE ON FUNCTION public.propria_key_movement_apply() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propria_units_log_code_changes() FROM anon, authenticated, public;

NOTIFY pgrst, 'reload schema';
