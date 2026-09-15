-- ─── Module Check-up logement — MVP (chantier 11.a marathon, consultant U26,
--     décision CEO A2 : MVP d'abord, automatisations 11.b et pilotage 11.c suivront) ───
--
-- Un check-up = inspection périodique d'un lot (ou du bien entier) par un
-- contrôleur terrain : checklist d'items notés OK / Problème / N/A, photos
-- obligatoires sur les problèmes, validation back-office qui transforme les
-- problèmes cochés en tâches/interventions (traçabilité source_checkup_id).
--
-- Conventions respectées :
--   • dérivés jamais stockés (nb problèmes etc. = calculés à la lecture)
--   • soft-delete uniquement (deleted_at)
--   • scope « Option B » : EXACTEMENT un de property_id / propria_unit_id
--     (même contrainte que propria_interventions_scope_check)
--   • bucket réutilisé 'intervention-proofs', chemin checkups/<checkup_id>/...
-- Idempotent : rejouable sans effet de bord.

-- ─── 1) Table principale ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.propria_checkups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  propria_unit_id  uuid REFERENCES public.propria_units(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'a_faire'
    CHECK (status IN ('a_faire','en_cours','a_valider','valide','annule')),
  assigned_to_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date         date,
  started_at       timestamptz,
  submitted_at     timestamptz,
  validated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  validated_at     timestamptz,
  observations     text,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT propria_checkups_scope_check
    CHECK ((property_id IS NULL) <> (propria_unit_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_propria_checkups_status
  ON public.propria_checkups(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_checkups_unit
  ON public.propria_checkups(propria_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_checkups_property
  ON public.propria_checkups(property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_checkups_assigned
  ON public.propria_checkups(assigned_to_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_checkups_set_updated_at ON public.propria_checkups;
CREATE TRIGGER propria_checkups_set_updated_at
  BEFORE UPDATE ON public.propria_checkups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2) Items de checklist (1 ligne par item renseigné, clé stable) ──────
CREATE TABLE IF NOT EXISTS public.propria_checkup_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkup_id  uuid NOT NULL REFERENCES public.propria_checkups(id) ON DELETE CASCADE,
  item_key    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('ok','probleme','na')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- 1 seul item vivant par (check-up, clé) — soft-delete friendly
CREATE UNIQUE INDEX IF NOT EXISTS uq_propria_checkup_items_key
  ON public.propria_checkup_items(checkup_id, item_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_checkup_items_checkup
  ON public.propria_checkup_items(checkup_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS propria_checkup_items_set_updated_at ON public.propria_checkup_items;
CREATE TRIGGER propria_checkup_items_set_updated_at
  BEFORE UPDATE ON public.propria_checkup_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3) Preuves photo (même structure que propria_cleaning_proofs) ───────
-- Bucket réutilisé 'intervention-proofs', chemin checkups/<checkup_id>/...
CREATE TABLE IF NOT EXISTS public.propria_checkup_proofs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkup_id    uuid NOT NULL REFERENCES public.propria_checkups(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  mime_type     text,
  size_bytes    integer,
  uploaded_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  item_key      text,          -- NULL = photo générale du check-up
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_propria_checkup_proofs_checkup
  ON public.propria_checkup_proofs(checkup_id) WHERE deleted_at IS NULL;

-- ─── 4) RLS ───────────────────────────────────────────────────────────────
-- Lecture : tout le staff. Écriture : ceo + assistante + propria.
-- DELETE (hard) : CEO uniquement — en pratique on ne fait que du soft-delete
-- (UPDATE deleted_at), la policy DELETE n'est qu'un filet de sécurité.
ALTER TABLE public.propria_checkups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propria_checkup_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propria_checkup_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read checkups"    ON public.propria_checkups;
DROP POLICY IF EXISTS "propria insert checkups" ON public.propria_checkups;
DROP POLICY IF EXISTS "propria update checkups" ON public.propria_checkups;
DROP POLICY IF EXISTS "ceo delete checkups"     ON public.propria_checkups;
CREATE POLICY "staff read checkups"     ON public.propria_checkups
  FOR SELECT USING (public.is_staff());
CREATE POLICY "propria insert checkups" ON public.propria_checkups
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "propria update checkups" ON public.propria_checkups
  FOR UPDATE USING (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ceo delete checkups"     ON public.propria_checkups
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

DROP POLICY IF EXISTS "staff read checkup items"    ON public.propria_checkup_items;
DROP POLICY IF EXISTS "propria insert checkup items" ON public.propria_checkup_items;
DROP POLICY IF EXISTS "propria update checkup items" ON public.propria_checkup_items;
DROP POLICY IF EXISTS "ceo delete checkup items"     ON public.propria_checkup_items;
CREATE POLICY "staff read checkup items"     ON public.propria_checkup_items
  FOR SELECT USING (public.is_staff());
CREATE POLICY "propria insert checkup items" ON public.propria_checkup_items
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "propria update checkup items" ON public.propria_checkup_items
  FOR UPDATE USING (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ceo delete checkup items"     ON public.propria_checkup_items
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

DROP POLICY IF EXISTS "staff read checkup proofs"    ON public.propria_checkup_proofs;
DROP POLICY IF EXISTS "propria insert checkup proofs" ON public.propria_checkup_proofs;
DROP POLICY IF EXISTS "propria update checkup proofs" ON public.propria_checkup_proofs;
DROP POLICY IF EXISTS "ceo delete checkup proofs"     ON public.propria_checkup_proofs;
CREATE POLICY "staff read checkup proofs"     ON public.propria_checkup_proofs
  FOR SELECT USING (public.is_staff());
CREATE POLICY "propria insert checkup proofs" ON public.propria_checkup_proofs
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "propria update checkup proofs" ON public.propria_checkup_proofs
  FOR UPDATE USING (public.is_staff(ARRAY['ceo','assistante','propria']));
CREATE POLICY "ceo delete checkup proofs"     ON public.propria_checkup_proofs
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

-- ─── 5) Commentaires partagés : élargir aux check-ups ─────────────────────
ALTER TABLE public.propria_comments
  DROP CONSTRAINT IF EXISTS propria_comments_entity_type_check;
ALTER TABLE public.propria_comments
  ADD CONSTRAINT propria_comments_entity_type_check
  CHECK (entity_type IN ('litige','avis','incident','checkup'));

-- ─── 6) Traçabilité : tâches/interventions créées depuis un check-up ─────
ALTER TABLE public.propria_interventions
  ADD COLUMN IF NOT EXISTS source_checkup_id uuid
  REFERENCES public.propria_checkups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_propria_interventions_source_checkup
  ON public.propria_interventions(source_checkup_id)
  WHERE source_checkup_id IS NOT NULL;

-- ─── 7) Commentaires de schéma ────────────────────────────────────────────
COMMENT ON TABLE public.propria_checkups IS
  'Check-ups logement (chantier 11.a) : inspection périodique d''un lot ou du bien entier — checklist OK/Problème/N/A, photos obligatoires sur problèmes, validation back-office qui génère tâches/interventions.';
COMMENT ON COLUMN public.propria_checkup_items.item_key IS
  'Clé stable d''item de checklist — référentiel lib/propria/checkup-checklist.ts. Jamais de libellé en dur en BDD.';
COMMENT ON COLUMN public.propria_checkup_proofs.item_key IS
  'Clé d''item de checklist à laquelle la photo est rattachée. NULL = photo générale.';
COMMENT ON COLUMN public.propria_interventions.source_checkup_id IS
  'Check-up à l''origine de cette tâche/intervention (créée à la validation du check-up).';

NOTIFY pgrst, 'reload schema';
