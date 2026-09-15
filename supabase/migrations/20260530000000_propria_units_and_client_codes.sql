-- ============================================================================
-- Refonte projets/propria — codes lisibles + séparation bien source / lot
-- ============================================================================
-- Modélise la réalité business Stoniz : un client achète un bien (Palmeraie)
-- que Stoniz divise en plusieurs lots locatifs (Bennani-1, Bennani-2). Chaque
-- lot a son propre listing Airbnb/Booking, son inventaire, ses dépenses.
--
-- Ce que cette migration fait :
--   1. Helpers SQL slugify / next_available_code (idempotents).
--   2. clients.slug, projects.code, projects.code_locked.
--   3. Nouvelle table propria_units (1..N lots par bien Propria).
--   4. FK Option B sur les 8 tables Propria (property_id OR propria_unit_id,
--      exactement une des deux remplie).
--   5. Trigger BEFORE INSERT sur clients : slug auto.
--   6. Trigger AFTER UPDATE OF full_name sur clients : propage le rename
--      vers projects.code et propria_units.code (sauf si code_locked).
--   7. Backfill idempotent : clients.slug, projects.code, propria_units
--      pour les biens déjà en gestion Propria, FK vers propria_units sur
--      les 8 tables enfants.
--   8. Vue d'agrégation v_property_propria_kpis.
--   9. RLS sur propria_units (mêmes règles que les autres tables Propria).
--  10. COMMENT 'DEPRECATED' sur les 16 colonnes bucket (b) de properties.
--      Pas de DROP — cleanup différé à +30 jours via une migration séparée.
--
-- Cette migration est IDEMPOTENTE : rejouable sans effet de bord, garde-fous
-- IF NOT EXISTS / WHERE ...IS NULL / DROP IF EXISTS partout.
-- ============================================================================

-- ─── 0. Extension utilitaire ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─── 1. Helpers slug ────────────────────────────────────────────────────────
-- slugify(text) : lowercase + unaccent + non-alphanumérique → '-' + compact.
CREATE OR REPLACE FUNCTION slugify(input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  s TEXT;
BEGIN
  IF input IS NULL OR length(trim(input)) = 0 THEN
    RETURN NULL;
  END IF;
  s := lower(unaccent(input));
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '-+', '-', 'g');
  s := regexp_replace(s, '^-|-$', '', 'g');
  IF length(s) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN s;
END;
$$;

COMMENT ON FUNCTION slugify(TEXT) IS
  'Normalise un texte en slug ASCII lowercase. NULL si entrée vide ou sans caractère alphanumérique. Utilise unaccent pour retirer les accents.';

-- next_available_code(base, table_name, column_name) :
-- Essaie base, puis base-2, base-3... jusqu'à trouver un slot libre.
-- Idempotent : si on lui repasse un code déjà attribué à la ligne courante,
-- l'appelant doit gérer (cette fonction renvoie toujours le PROCHAIN libre).
CREATE OR REPLACE FUNCTION next_available_code(
  p_base TEXT,
  p_table TEXT,
  p_column TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
  suffix INTEGER := 1;
  taken BOOLEAN;
  sql TEXT;
BEGIN
  IF p_base IS NULL OR length(p_base) = 0 THEN
    RAISE EXCEPTION 'next_available_code: base vide non autorisée';
  END IF;
  candidate := p_base;
  LOOP
    sql := format('SELECT EXISTS(SELECT 1 FROM %I WHERE %I = $1)', p_table, p_column);
    EXECUTE sql INTO taken USING candidate;
    EXIT WHEN NOT taken;
    suffix := suffix + 1;
    candidate := p_base || '-' || suffix::text;
  END LOOP;
  RETURN candidate;
END;
$$;

COMMENT ON FUNCTION next_available_code(TEXT, TEXT, TEXT) IS
  'Renvoie le prochain code disponible en suffixant -2, -3, etc. Cas usage : codes uniques clients/projets/lots avec disambiguation auto.';

-- ─── 2. clients.slug ────────────────────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS slug TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'clients_slug_uniq'
  ) THEN
    CREATE UNIQUE INDEX clients_slug_uniq ON clients (slug) WHERE slug IS NOT NULL;
  END IF;
END$$;

COMMENT ON COLUMN clients.slug IS
  'Slug ASCII lowercase du nom du client. Source de vérité pour la propagation des codes projet et propria_units. Auto-géré par le trigger.';

-- ─── 3. projects.code + code_locked ─────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS code_locked BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'projects_code_uniq'
  ) THEN
    CREATE UNIQUE INDEX projects_code_uniq ON projects (code) WHERE code IS NOT NULL;
  END IF;
END$$;

COMMENT ON COLUMN projects.code IS
  'Code lisible du projet (slug du nom client, ex bennani). Propagé auto au rename client si code_locked = false. reference STZ-NNN conservée séparément pour compta.';
COMMENT ON COLUMN projects.code_locked IS
  'Si true, le rename d''un client ne met PAS à jour ce code (l''équipe a renommé manuellement).';

-- ─── 4. Nouvelle table propria_units ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL CHECK (order_index >= 1),
  code TEXT NOT NULL,
  code_locked BOOLEAN NOT NULL DEFAULT false,
  -- 16 colonnes bucket (b) — préfixe propria_ conservé pour cohérence repo
  propria_apartment_door     TEXT,
  propria_capacity_voyageurs INTEGER,
  propria_nb_chambres        INTEGER,
  propria_type_lits          TEXT,
  propria_smart_lock         BOOLEAN NOT NULL DEFAULT false,
  propria_lock_code          TEXT,
  propria_key_box_home       TEXT,
  propria_nb_keys            INTEGER,
  propria_wifi_ssid          TEXT,
  propria_wifi_password      TEXT,
  propria_airbnb_url         TEXT,
  propria_booking_url        TEXT,
  propria_listing_published_at DATE,
  propria_base_price_per_night NUMERIC(10,2),
  propria_drive_photos_url   TEXT,
  propria_default_provider_id UUID REFERENCES propria_providers(id),
  propria_info_sheet_to_send BOOLEAN NOT NULL DEFAULT false,
  propria_app_admin_access   BOOLEAN NOT NULL DEFAULT false,
  propria_observations       TEXT,
  -- Métadonnées
  is_active   BOOLEAN NOT NULL DEFAULT true,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, order_index)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'propria_units_code_uniq'
  ) THEN
    CREATE UNIQUE INDEX propria_units_code_uniq
      ON propria_units (code) WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'propria_units_property_active_idx'
  ) THEN
    CREATE INDEX propria_units_property_active_idx
      ON propria_units (property_id) WHERE deleted_at IS NULL AND is_active = true;
  END IF;
END$$;

DROP TRIGGER IF EXISTS propria_units_updated_at ON propria_units;
CREATE TRIGGER propria_units_updated_at
  BEFORE UPDATE ON propria_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE propria_units IS
  'Lots locatifs Propria. Un bien (Palmeraie 80m²) divisé en N lots (Bennani-1 40m², Bennani-2 40m²). Chaque lot a son propre listing.';
COMMENT ON COLUMN propria_units.code IS
  'Code lisible du lot (slug client + order_index, ex bennani-1). Propagé auto au rename client si code_locked = false.';
COMMENT ON COLUMN propria_units.code_locked IS
  'Si true, le rename client ne met pas à jour ce code (équipe a renommé manuellement, ou code historique conservé comme "Riad Majorelle").';

-- ─── 5. FK Option B sur les 8 tables Propria ────────────────────────────────
-- propria_unit_id ajouté nullable. CHECK (property_id IS NULL) <> (unit_id IS NULL)
-- ajouté APRÈS le backfill (voir section 8) pour ne pas bloquer la migration.

ALTER TABLE propria_interventions       ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_maintenance_visits  ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_wallet_expenses     ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_stock_movements     ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_cash_reservations   ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_transfers           ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_inventories         ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);
ALTER TABLE propria_listing_metrics     ADD COLUMN IF NOT EXISTS propria_unit_id UUID REFERENCES propria_units(id);

-- propria_cash_reservations.property_id était NOT NULL — on relâche pour Option B
ALTER TABLE propria_cash_reservations ALTER COLUMN property_id DROP NOT NULL;
-- propria_interventions.property_id était NOT NULL — idem
ALTER TABLE propria_interventions ALTER COLUMN property_id DROP NOT NULL;
-- propria_maintenance_visits.property_id était NOT NULL — idem
ALTER TABLE propria_maintenance_visits ALTER COLUMN property_id DROP NOT NULL;
-- propria_inventories.property_id était NOT NULL — idem
ALTER TABLE propria_inventories ALTER COLUMN property_id DROP NOT NULL;
-- propria_listing_metrics.property_id était NOT NULL — idem
ALTER TABLE propria_listing_metrics ALTER COLUMN property_id DROP NOT NULL;

-- Index pour les FK ajoutées
DO $$
DECLARE
  t TEXT;
  idx_name TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'propria_interventions','propria_maintenance_visits','propria_wallet_expenses',
    'propria_stock_movements','propria_cash_reservations','propria_transfers',
    'propria_inventories','propria_listing_metrics'
  ])
  LOOP
    idx_name := t || '_unit_idx';
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = idx_name
    ) THEN
      EXECUTE format(
        'CREATE INDEX %I ON %I (propria_unit_id) WHERE propria_unit_id IS NOT NULL',
        idx_name, t
      );
    END IF;
  END LOOP;
END$$;

-- ─── 6. Trigger BEFORE INSERT clients : slug auto ───────────────────────────
CREATE OR REPLACE FUNCTION trg_clients_set_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base TEXT;
BEGIN
  IF NEW.slug IS NOT NULL AND length(NEW.slug) > 0 THEN
    RETURN NEW;
  END IF;
  base := slugify(NEW.full_name);
  IF base IS NULL THEN
    base := 'client-' || substr(NEW.id::text, 1, 8);
  END IF;
  NEW.slug := next_available_code(base, 'clients', 'slug');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_set_slug ON clients;
CREATE TRIGGER clients_set_slug
  BEFORE INSERT ON clients
  FOR EACH ROW EXECUTE FUNCTION trg_clients_set_slug();

-- ─── 7. Trigger AFTER UPDATE OF full_name : propagation ─────────────────────
CREATE OR REPLACE FUNCTION trg_clients_propagate_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_base_slug TEXT;
  new_client_slug TEXT;
  prj RECORD;
  unit RECORD;
  unit_base TEXT;
  new_project_code TEXT;
  new_unit_code TEXT;
BEGIN
  IF NEW.full_name IS NOT DISTINCT FROM OLD.full_name THEN
    RETURN NEW;
  END IF;

  new_base_slug := slugify(NEW.full_name);
  IF new_base_slug IS NULL THEN
    new_base_slug := 'client-' || substr(NEW.id::text, 1, 8);
  END IF;

  -- Si le slug recalculé = ancien slug, rien à propager
  IF new_base_slug = OLD.slug THEN
    RETURN NEW;
  END IF;

  -- Recalcule clients.slug en excluant la ligne courante de la collision
  -- (sinon next_available_code verrait son propre slug et passerait au -2)
  IF EXISTS (
    SELECT 1 FROM clients c
    WHERE c.slug = new_base_slug AND c.id <> NEW.id
  ) THEN
    new_client_slug := next_available_code(new_base_slug, 'clients', 'slug');
  ELSE
    new_client_slug := new_base_slug;
  END IF;
  UPDATE clients SET slug = new_client_slug WHERE id = NEW.id;

  -- Propage aux projets non-verrouillés
  FOR prj IN
    SELECT id, code FROM projects
    WHERE client_id = NEW.id AND code_locked = false AND code IS NOT NULL
  LOOP
    -- Exclut la ligne courante du test de collision
    IF EXISTS (
      SELECT 1 FROM projects p
      WHERE p.code = new_client_slug AND p.id <> prj.id
    ) THEN
      new_project_code := next_available_code(new_client_slug, 'projects', 'code');
    ELSE
      new_project_code := new_client_slug;
    END IF;
    UPDATE projects SET code = new_project_code WHERE id = prj.id;
  END LOOP;

  -- Propage aux lots Propria non-verrouillés
  FOR unit IN
    SELECT u.id, u.code, u.order_index
    FROM propria_units u
    INNER JOIN projects p ON p.property_id = u.property_id
    WHERE p.client_id = NEW.id AND u.code_locked = false AND u.deleted_at IS NULL
  LOOP
    unit_base := new_client_slug || '-' || unit.order_index::text;
    IF EXISTS (
      SELECT 1 FROM propria_units uu
      WHERE uu.code = unit_base AND uu.id <> unit.id AND uu.deleted_at IS NULL
    ) THEN
      new_unit_code := next_available_code(unit_base, 'propria_units', 'code');
    ELSE
      new_unit_code := unit_base;
    END IF;
    UPDATE propria_units SET code = new_unit_code WHERE id = unit.id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_propagate_rename ON clients;
CREATE TRIGGER clients_propagate_rename
  AFTER UPDATE OF full_name ON clients
  FOR EACH ROW EXECUTE FUNCTION trg_clients_propagate_rename();

-- ─── 8. Backfill idempotent ─────────────────────────────────────────────────

-- 8.1 clients.slug pour les clients sans slug
UPDATE clients c
SET slug = next_available_code(
  COALESCE(slugify(c.full_name), 'client-' || substr(c.id::text, 1, 8)),
  'clients', 'slug'
)
WHERE c.slug IS NULL;

-- 8.2 projects.code pour les projets sans code
DO $$
DECLARE
  prj RECORD;
  base TEXT;
BEGIN
  FOR prj IN
    SELECT p.id, p.client_id, c.slug AS client_slug
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.code IS NULL
    ORDER BY p.created_at ASC
  LOOP
    base := COALESCE(prj.client_slug, 'projet-' || substr(prj.id::text, 1, 8));
    UPDATE projects
      SET code = next_available_code(base, 'projects', 'code'),
          code_locked = CASE WHEN prj.client_id IS NULL THEN true ELSE false END
      WHERE id = prj.id;
  END LOOP;
END$$;

-- 8.3 Création d'un propria_unit pour chaque bien déjà en gestion Propria
-- Stratégie : 1 unit avec order_index=1, en recopiant les 16 colonnes
-- bucket (b) depuis properties. Code = propria_internal_code si présent
-- (avec code_locked=true), sinon {client_slug}-1.
DO $$
DECLARE
  prop RECORD;
  client_slug TEXT;
  unit_base TEXT;
  unit_code TEXT;
  locked BOOLEAN;
BEGIN
  FOR prop IN
    SELECT
      p.id AS property_id,
      p.propria_internal_code,
      p.propria_apartment_door,
      p.propria_capacity_voyageurs,
      p.propria_nb_chambres,
      p.propria_type_lits,
      p.propria_smart_lock,
      p.propria_lock_code,
      p.propria_key_box_home,
      p.propria_nb_keys,
      p.propria_wifi_ssid,
      p.propria_wifi_password,
      p.propria_airbnb_url,
      p.propria_booking_url,
      p.propria_listing_published_at,
      p.propria_base_price_per_night,
      p.propria_drive_photos_url,
      p.propria_default_provider_id,
      p.propria_info_sheet_to_send,
      p.propria_app_admin_access,
      p.propria_observations,
      c.slug AS client_slug_calc,
      p.propria_owner_name,
      p.name AS property_name
    FROM properties p
    LEFT JOIN projects pr ON pr.property_id = p.id
    LEFT JOIN clients c ON c.id = pr.client_id
    WHERE p.propria_managed_at IS NOT NULL
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM propria_units u
        WHERE u.property_id = p.id AND u.order_index = 1
      )
  LOOP
    -- Détermine le code : on conserve le code historique si présent
    IF prop.propria_internal_code IS NOT NULL AND length(trim(prop.propria_internal_code)) > 0 THEN
      unit_code := next_available_code(prop.propria_internal_code, 'propria_units', 'code');
      locked := true;
    ELSE
      client_slug := COALESCE(
        prop.client_slug_calc,
        slugify(prop.propria_owner_name),
        slugify(prop.property_name),
        'bien-' || substr(prop.property_id::text, 1, 8)
      );
      unit_base := client_slug || '-1';
      unit_code := next_available_code(unit_base, 'propria_units', 'code');
      locked := false;
    END IF;

    INSERT INTO propria_units (
      property_id, order_index, code, code_locked,
      propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
      propria_type_lits, propria_smart_lock, propria_lock_code,
      propria_key_box_home, propria_nb_keys, propria_wifi_ssid,
      propria_wifi_password, propria_airbnb_url, propria_booking_url,
      propria_listing_published_at, propria_base_price_per_night,
      propria_drive_photos_url, propria_default_provider_id,
      propria_info_sheet_to_send, propria_app_admin_access, propria_observations
    ) VALUES (
      prop.property_id, 1, unit_code, locked,
      prop.propria_apartment_door, prop.propria_capacity_voyageurs, prop.propria_nb_chambres,
      prop.propria_type_lits, COALESCE(prop.propria_smart_lock, false), prop.propria_lock_code,
      prop.propria_key_box_home, prop.propria_nb_keys, prop.propria_wifi_ssid,
      prop.propria_wifi_password, prop.propria_airbnb_url, prop.propria_booking_url,
      prop.propria_listing_published_at, prop.propria_base_price_per_night,
      prop.propria_drive_photos_url, prop.propria_default_provider_id,
      COALESCE(prop.propria_info_sheet_to_send, false),
      COALESCE(prop.propria_app_admin_access, false),
      prop.propria_observations
    );
  END LOOP;
END$$;

-- 8.4 Migration des FK enfants : déplace property_id → propria_unit_id
-- pour chaque ligne où la property a maintenant un unit (order_index=1).
-- On laisse property_id pour les lignes où la property n'a pas d'unit
-- (interventions / dépenses sur bien non-Propria).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'propria_interventions','propria_maintenance_visits','propria_wallet_expenses',
    'propria_stock_movements','propria_cash_reservations','propria_transfers',
    'propria_inventories','propria_listing_metrics'
  ])
  LOOP
    EXECUTE format($f$
      UPDATE %I child
      SET propria_unit_id = u.id,
          property_id = NULL
      FROM propria_units u
      WHERE child.property_id IS NOT NULL
        AND child.propria_unit_id IS NULL
        AND u.property_id = child.property_id
        AND u.order_index = 1
        AND u.deleted_at IS NULL
    $f$, t);
  END LOOP;
END$$;

-- 8.5 Contraintes CHECK Option B : exactement une des deux FK remplie.
-- On vérifie d'abord qu'aucune ligne ne viole avant d'ajouter la contrainte.
DO $$
DECLARE
  t TEXT;
  bad_count INTEGER;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'propria_interventions','propria_maintenance_visits','propria_wallet_expenses',
    'propria_stock_movements','propria_cash_reservations','propria_transfers',
    'propria_inventories','propria_listing_metrics'
  ])
  LOOP
    -- Cas particulier : wallet_expenses, stock_movements, transfers peuvent
    -- avoir property_id ET propria_unit_id NULL (dépenses hors bien, ex courses bureau)
    -- → CHECK = "pas les DEUX remplis"
    -- Autres tables : doivent avoir EXACTEMENT UN des deux rempli
    IF t IN ('propria_wallet_expenses','propria_stock_movements','propria_transfers') THEN
      EXECUTE format(
        'SELECT count(*) FROM %I WHERE property_id IS NOT NULL AND propria_unit_id IS NOT NULL',
        t
      ) INTO bad_count;
      IF bad_count > 0 THEN
        RAISE EXCEPTION '% : % lignes ont property_id ET propria_unit_id remplis (incompatible Option B)', t, bad_count;
      END IF;
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
        t, t || '_scope_check'
      );
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (NOT (property_id IS NOT NULL AND propria_unit_id IS NOT NULL))',
        t, t || '_scope_check'
      );
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM %I WHERE (property_id IS NULL AND propria_unit_id IS NULL) OR (property_id IS NOT NULL AND propria_unit_id IS NOT NULL)',
        t
      ) INTO bad_count;
      IF bad_count > 0 THEN
        RAISE EXCEPTION '% : % lignes ne respectent pas Option B (exactement une FK requise)', t, bad_count;
      END IF;
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
        t, t || '_scope_check'
      );
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK ((property_id IS NULL) <> (propria_unit_id IS NULL))',
        t, t || '_scope_check'
      );
    END IF;
  END LOOP;
END$$;

-- 8.6 Triggers BEFORE INSERT auto-code pour projects et propria_units
-- Garantit que toute nouvelle ligne aura un code, même si l'app oublie.
CREATE OR REPLACE FUNCTION trg_projects_set_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base TEXT;
  client_slug_val TEXT;
BEGIN
  IF NEW.code IS NOT NULL AND length(NEW.code) > 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NOT NULL THEN
    SELECT slug INTO client_slug_val FROM clients WHERE id = NEW.client_id;
  END IF;
  base := COALESCE(client_slug_val, 'projet-' || substr(NEW.id::text, 1, 8));
  NEW.code := next_available_code(base, 'projects', 'code');
  IF client_slug_val IS NULL THEN
    NEW.code_locked := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_code ON projects;
CREATE TRIGGER projects_set_code
  BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_projects_set_code();

CREATE OR REPLACE FUNCTION trg_propria_units_set_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base TEXT;
  client_slug_val TEXT;
  next_order INTEGER;
BEGIN
  -- Auto-calcule order_index si pas fourni
  IF NEW.order_index IS NULL THEN
    SELECT COALESCE(MAX(order_index), 0) + 1
      INTO next_order
      FROM propria_units
      WHERE property_id = NEW.property_id;
    NEW.order_index := next_order;
  END IF;
  IF NEW.code IS NOT NULL AND length(NEW.code) > 0 THEN
    RETURN NEW;
  END IF;
  -- Récupère le slug du client via property → project → client
  SELECT c.slug INTO client_slug_val
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.property_id = NEW.property_id
    LIMIT 1;
  base := COALESCE(client_slug_val, 'lot-' || substr(NEW.property_id::text, 1, 8));
  NEW.code := next_available_code(base || '-' || NEW.order_index::text, 'propria_units', 'code');
  IF client_slug_val IS NULL THEN
    NEW.code_locked := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS propria_units_set_code ON propria_units;
CREATE TRIGGER propria_units_set_code
  BEFORE INSERT ON propria_units
  FOR EACH ROW EXECUTE FUNCTION trg_propria_units_set_code();

-- NOT NULL sur projects.code après backfill ET trigger installé
ALTER TABLE projects ALTER COLUMN code SET NOT NULL;
-- propria_units.code est déjà NOT NULL dans la définition

-- ─── 9. Vue d'agrégation KPI Propria ────────────────────────────────────────
-- Expose les KPI calculés depuis les lots actifs d'un bien. Les colonnes
-- properties.revenu_locatif_brut_annuel et taux_occupation restent en place
-- (saisies au sourcing comme estimation). L'UI peut choisir laquelle afficher.
CREATE OR REPLACE VIEW v_property_propria_kpis AS
SELECT
  p.id AS property_id,
  COUNT(u.id) FILTER (WHERE u.is_active AND u.deleted_at IS NULL) AS nb_units_active,
  COUNT(u.id) FILTER (
    WHERE u.deleted_at IS NULL AND u.propria_listing_published_at IS NOT NULL
  ) AS nb_units_published,
  SUM(u.propria_base_price_per_night * 365) FILTER (
    WHERE u.is_active AND u.deleted_at IS NULL AND u.propria_base_price_per_night IS NOT NULL
  ) AS revenu_brut_potentiel_annuel,
  AVG(lm.rating) FILTER (WHERE lm.rating IS NOT NULL) AS avg_listing_rating,
  AVG(lm.occupancy_rate) FILTER (WHERE lm.occupancy_rate IS NOT NULL) AS avg_occupancy_rate
FROM properties p
LEFT JOIN propria_units u ON u.property_id = p.id
LEFT JOIN propria_listing_metrics lm ON lm.propria_unit_id = u.id
WHERE p.deleted_at IS NULL
GROUP BY p.id;

COMMENT ON VIEW v_property_propria_kpis IS
  'KPI Propria agrégés par bien source depuis les lots actifs. Utilisé par dashboards et fiche bien. Recalculé à la lecture (vue, pas table matérialisée).';

GRANT SELECT ON v_property_propria_kpis TO authenticated;

-- ─── 10. RLS sur propria_units ──────────────────────────────────────────────
ALTER TABLE propria_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS propria_units_staff_all ON propria_units;
CREATE POLICY propria_units_staff_all ON propria_units
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('ceo','chef_projet','sourcing','commercial','finance','marketing','assistante')
        AND profiles.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('ceo','chef_projet','sourcing','commercial','finance','marketing','assistante')
        AND profiles.is_active = true
    )
  );

-- ─── 11. Marquage DEPRECATED des colonnes bucket (b) sur properties ─────────
-- AUCUN DROP. Cleanup différé à +30 jours dans une migration séparée pour
-- permettre rollback si on découvre un usage oublié en prod.
COMMENT ON COLUMN properties.propria_internal_code IS
  'DEPRECATED — migré vers propria_units.code. Cleanup prévu à +30 jours. Lire propria_units pour les nouvelles écritures.';
COMMENT ON COLUMN properties.propria_apartment_door IS
  'DEPRECATED — migré vers propria_units.propria_apartment_door. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_capacity_voyageurs IS
  'DEPRECATED — migré vers propria_units.propria_capacity_voyageurs. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_nb_chambres IS
  'DEPRECATED — migré vers propria_units.propria_nb_chambres. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_type_lits IS
  'DEPRECATED — migré vers propria_units.propria_type_lits. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_smart_lock IS
  'DEPRECATED — migré vers propria_units.propria_smart_lock. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_lock_code IS
  'DEPRECATED — migré vers propria_units.propria_lock_code. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_key_box_home IS
  'DEPRECATED — migré vers propria_units.propria_key_box_home. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_nb_keys IS
  'DEPRECATED — migré vers propria_units.propria_nb_keys. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_wifi_ssid IS
  'DEPRECATED — migré vers propria_units.propria_wifi_ssid. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_wifi_password IS
  'DEPRECATED — migré vers propria_units.propria_wifi_password. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_airbnb_url IS
  'DEPRECATED — migré vers propria_units.propria_airbnb_url. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_booking_url IS
  'DEPRECATED — migré vers propria_units.propria_booking_url. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_listing_published_at IS
  'DEPRECATED — migré vers propria_units.propria_listing_published_at. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_base_price_per_night IS
  'DEPRECATED — migré vers propria_units.propria_base_price_per_night. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_drive_photos_url IS
  'DEPRECATED — migré vers propria_units.propria_drive_photos_url. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_default_provider_id IS
  'DEPRECATED — migré vers propria_units.propria_default_provider_id. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_info_sheet_to_send IS
  'DEPRECATED — migré vers propria_units.propria_info_sheet_to_send. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_app_admin_access IS
  'DEPRECATED — migré vers propria_units.propria_app_admin_access. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_observations IS
  'DEPRECATED — migré vers propria_units.propria_observations. Cleanup prévu à +30 jours.';
COMMENT ON COLUMN properties.propria_google_maps_url IS
  'DEPRECATED — doublon de properties.google_maps_url. Cleanup prévu à +30 jours.';

-- ============================================================================
-- Fin de la migration L1.
-- État cible :
--   - Tous les clients ont un slug.
--   - Tous les projets ont un code (slug du client, disambiguation auto).
--   - Tous les biens en gestion Propria ont 1 propria_unit (order_index=1).
--   - Les 8 tables Propria référencent propria_unit_id (property_id NULL).
--   - 21 colonnes propria_* sur properties marquées DEPRECATED en commentaire.
--   - Vue v_property_propria_kpis exposée aux dashboards.
--   - Trigger de propagation rename client opérationnel.
-- ============================================================================
