-- ============================================================================
-- PROPRIA — Module conciergerie / gestion locative court-terme
-- Fondations : extension properties + tables Propria + RLS + seeds
-- ============================================================================

-- ─── 1. Extension de la table `properties` ────────────────────────────────
-- Un bien devient "Propria" quand propria_managed_at est défini.
-- Les biens externes (non Stoniz) sont créés avec propria_managed_at = now()
-- et status laissé à 'sourcing' ou ignoré.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS propria_managed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS propria_internal_code      TEXT,         -- ex: "Riad Majorelle", "AF 1"
  ADD COLUMN IF NOT EXISTS propria_owner_name         TEXT,         -- propriétaire (peut être différent du client Stoniz)
  ADD COLUMN IF NOT EXISTS propria_owner_phone        TEXT,
  ADD COLUMN IF NOT EXISTS propria_owner_email        TEXT,
  ADD COLUMN IF NOT EXISTS propria_owner_address      TEXT,
  ADD COLUMN IF NOT EXISTS propria_apartment_door     TEXT,         -- porte
  ADD COLUMN IF NOT EXISTS propria_capacity_voyageurs INTEGER,
  ADD COLUMN IF NOT EXISTS propria_nb_chambres        INTEGER,
  ADD COLUMN IF NOT EXISTS propria_type_lits          TEXT,         -- ex "1 king + 2 simples"
  ADD COLUMN IF NOT EXISTS propria_google_maps_url    TEXT,
  -- Banque (propriétaire)
  ADD COLUMN IF NOT EXISTS propria_bank_name          TEXT,
  ADD COLUMN IF NOT EXISTS propria_bank_rib           TEXT,
  ADD COLUMN IF NOT EXISTS propria_bank_iban          TEXT,
  ADD COLUMN IF NOT EXISTS propria_bank_swift         TEXT,
  -- Mandat
  ADD COLUMN IF NOT EXISTS propria_mandate_start      DATE,
  ADD COLUMN IF NOT EXISTS propria_mandate_end        DATE,
  ADD COLUMN IF NOT EXISTS propria_commission_rate    NUMERIC(5,2), -- ex 20.00
  ADD COLUMN IF NOT EXISTS propria_mandate_conditions TEXT,
  -- Accès
  ADD COLUMN IF NOT EXISTS propria_access_admin       TEXT,         -- accès admin immeuble
  ADD COLUMN IF NOT EXISTS propria_lock_code          TEXT,         -- code serrure
  ADD COLUMN IF NOT EXISTS propria_key_box_home       TEXT,         -- boîte à clés logement
  ADD COLUMN IF NOT EXISTS propria_key_box_building   TEXT,         -- boîte à clés immeuble
  ADD COLUMN IF NOT EXISTS propria_key_box_location   TEXT,         -- emplacement
  ADD COLUMN IF NOT EXISTS propria_badge_building     TEXT,
  ADD COLUMN IF NOT EXISTS propria_elevator_code      TEXT,
  ADD COLUMN IF NOT EXISTS propria_parking_info       TEXT,
  ADD COLUMN IF NOT EXISTS propria_nb_keys            INTEGER,
  ADD COLUMN IF NOT EXISTS propria_guardian_name      TEXT,
  ADD COLUMN IF NOT EXISTS propria_guardian_phone     TEXT,
  -- Vidéo d'arrivée (obligatoire)
  ADD COLUMN IF NOT EXISTS propria_arrival_video_url  TEXT,
  ADD COLUMN IF NOT EXISTS propria_arrival_instructions TEXT,
  -- Contrats utilities
  ADD COLUMN IF NOT EXISTS propria_water_contract     TEXT,         -- n° contrat eau
  ADD COLUMN IF NOT EXISTS propria_water_meter        TEXT,
  ADD COLUMN IF NOT EXISTS propria_electricity_contract TEXT,
  ADD COLUMN IF NOT EXISTS propria_electricity_meter  TEXT,
  ADD COLUMN IF NOT EXISTS propria_internet_provider  TEXT,
  ADD COLUMN IF NOT EXISTS propria_internet_contract  TEXT,
  ADD COLUMN IF NOT EXISTS propria_wifi_ssid          TEXT,
  ADD COLUMN IF NOT EXISTS propria_wifi_password      TEXT,
  -- Syndic / camera
  ADD COLUMN IF NOT EXISTS propria_syndic_name        TEXT,
  ADD COLUMN IF NOT EXISTS propria_syndic_phone       TEXT,
  ADD COLUMN IF NOT EXISTS propria_camera_info        TEXT,
  -- Artisan référent (legacy reference, on link via providers ci-dessous)
  ADD COLUMN IF NOT EXISTS propria_default_provider_id UUID,
  -- Annonces
  ADD COLUMN IF NOT EXISTS propria_airbnb_url         TEXT,
  ADD COLUMN IF NOT EXISTS propria_booking_url        TEXT,
  ADD COLUMN IF NOT EXISTS propria_listing_published_at DATE,
  ADD COLUMN IF NOT EXISTS propria_base_price_per_night NUMERIC(10,2), -- MAD
  ADD COLUMN IF NOT EXISTS propria_drive_photos_url   TEXT,
  ADD COLUMN IF NOT EXISTS propria_observations       TEXT;

-- Index pour filtrer rapidement les biens Propria
CREATE INDEX IF NOT EXISTS properties_propria_idx
  ON properties (propria_managed_at) WHERE propria_managed_at IS NOT NULL AND deleted_at IS NULL;

-- ─── 2. Prestataires externes (artisans Propria, distincts des artisans Stoniz) ──
CREATE TABLE IF NOT EXISTS propria_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  function TEXT,                  -- "Menuiserie", "Plomberie", "Tout", ...
  phone TEXT,
  email TEXT,
  indicative_rate TEXT,           -- "Forfait mensuel", "150 DH/h", ...
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_providers_active_idx
  ON propria_providers (is_active) WHERE deleted_at IS NULL;

CREATE TRIGGER propria_providers_updated_at BEFORE UPDATE ON propria_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- FK depuis properties.propria_default_provider_id (créée tardivement pour éviter cyclique)
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_propria_default_provider_fkey;
ALTER TABLE properties
  ADD CONSTRAINT properties_propria_default_provider_fkey
  FOREIGN KEY (propria_default_provider_id) REFERENCES propria_providers(id);

-- ─── 3. Types d'intervention (catalogue) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_intervention_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN (
    'Technique','Entretien','Rénovation','Sécurité','Aménagement','Divers'
  )),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 4. Interventions (réactives) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  intervention_type_id UUID REFERENCES propria_intervention_types(id),
  type_label TEXT,                 -- fallback texte libre si pas de FK
  description TEXT NOT NULL,
  occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  urgency TEXT NOT NULL DEFAULT 'normale' CHECK (urgency IN (
    'critique','haute','normale','basse'
  )),
  status TEXT NOT NULL DEFAULT 'a_traiter' CHECK (status IN (
    'a_traiter','en_cours','cloture','annule'
  )),
  closed_at TIMESTAMPTZ,
  responsable_id UUID REFERENCES profiles(id),     -- collaborateur Stoniz qui gère
  provider_id UUID REFERENCES propria_providers(id),
  cost_propria_mad NUMERIC(12,2),                  -- coût supporté par Propria
  client_billing_mad NUMERIC(12,2),                -- ce qu'on refacture au client
  charge_to TEXT CHECK (charge_to IN ('client','propria','copropriete','a_definir')),
  hostaway_ref TEXT,                                -- lien réservation Hostaway si lié
  observations TEXT,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_interventions_property_idx
  ON propria_interventions (property_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS propria_interventions_status_idx
  ON propria_interventions (status, urgency) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS propria_interventions_responsable_idx
  ON propria_interventions (responsable_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER propria_interventions_updated_at BEFORE UPDATE ON propria_interventions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Vue enrichie avec marge
CREATE OR REPLACE VIEW propria_interventions_enriched AS
SELECT
  i.*,
  CASE
    WHEN i.client_billing_mad IS NOT NULL AND i.cost_propria_mad IS NOT NULL
    THEN i.client_billing_mad - i.cost_propria_mad
    ELSE NULL
  END AS marge_mad
FROM propria_interventions i
WHERE i.deleted_at IS NULL;

-- ─── 5. Maintenance préventive trimestrielle ──────────────────────────────
-- Une "visite" préventive = 1 ligne, générée auto chaque trimestre par cron.
CREATE TABLE IF NOT EXISTS propria_maintenance_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  quarter TEXT NOT NULL,                  -- "2026-Q2"
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_planifier' CHECK (status IN (
    'a_planifier','planifie','realise','en_retard'
  )),
  scheduled_at DATE,
  completed_at TIMESTAMPTZ,
  responsable_id UUID REFERENCES profiles(id),
  checklist JSONB NOT NULL DEFAULT '{}',  -- {"plomberie": {...}, "electricite": {...}, ...}
  photos TEXT[] DEFAULT '{}',             -- storage paths
  notes TEXT,
  follow_up_interventions UUID[] DEFAULT '{}', -- ids d'interventions créées suite à la visite
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, quarter)
);

CREATE INDEX IF NOT EXISTS propria_maintenance_status_idx
  ON propria_maintenance_visits (status, due_date);
CREATE INDEX IF NOT EXISTS propria_maintenance_property_idx
  ON propria_maintenance_visits (property_id, quarter);

CREATE TRIGGER propria_maintenance_updated_at BEFORE UPDATE ON propria_maintenance_visits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6. Caisse — wallets par collaborateur ─────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT,                              -- ex "Caisse Ayoub"
  opened_at DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_at DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, opened_at)
);

CREATE TRIGGER propria_wallets_updated_at BEFORE UPDATE ON propria_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Dotations (cash remis par Othmane au collaborateur)
CREATE TABLE IF NOT EXISTS propria_wallet_dotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES propria_wallets(id) ON DELETE CASCADE,
  given_at DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_mad NUMERIC(12,2) NOT NULL CHECK (amount_mad > 0),
  type TEXT NOT NULL DEFAULT 'dotation' CHECK (type IN ('dotation','rechargement')),
  given_by UUID REFERENCES profiles(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_dotations_wallet_idx
  ON propria_wallet_dotations (wallet_id, given_at DESC);

-- Remboursements / dépenses (cash dépensé par le collaborateur)
-- property_id NULLABLE : on peut dépenser hors bien (ex: courses bureau)
CREATE TABLE IF NOT EXISTS propria_wallet_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES propria_wallets(id) ON DELETE CASCADE,
  spent_at DATE NOT NULL DEFAULT CURRENT_DATE,
  property_id UUID REFERENCES properties(id),
  category TEXT,                   -- "Courses", "Réparation", "Transport", "Stock", ...
  description TEXT NOT NULL,
  amount_mad NUMERIC(12,2) NOT NULL CHECK (amount_mad > 0),
  receipt_path TEXT,               -- justificatif (Supabase storage)
  charge_to TEXT CHECK (charge_to IN ('client','propria','copropriete')),
  reimbursed_at DATE,
  reimbursed_by UUID REFERENCES profiles(id),
  is_validated BOOLEAN NOT NULL DEFAULT false,
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES profiles(id),
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_expenses_wallet_idx
  ON propria_wallet_expenses (wallet_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS propria_expenses_property_idx
  ON propria_wallet_expenses (property_id) WHERE property_id IS NOT NULL;

-- Vue solde par wallet
CREATE OR REPLACE VIEW propria_wallet_balances AS
SELECT
  w.id AS wallet_id,
  w.profile_id,
  w.label,
  COALESCE(d.total_dotations, 0)::numeric    AS total_dotations,
  COALESCE(e.total_expenses, 0)::numeric     AS total_expenses,
  COALESCE(e.total_reimbursed, 0)::numeric   AS total_reimbursed,
  (COALESCE(d.total_dotations, 0) - COALESCE(e.total_expenses, 0))::numeric AS solde_mad
FROM propria_wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_mad) AS total_dotations
  FROM propria_wallet_dotations GROUP BY wallet_id
) d ON d.wallet_id = w.id
LEFT JOIN (
  SELECT
    wallet_id,
    SUM(amount_mad) AS total_expenses,
    SUM(CASE WHEN reimbursed_at IS NOT NULL THEN amount_mad ELSE 0 END) AS total_reimbursed
  FROM propria_wallet_expenses GROUP BY wallet_id
) e ON e.wallet_id = w.id;

-- ─── 7. Stock consommables ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_consumables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,             -- "ENT-001"
  name TEXT NOT NULL,
  category TEXT NOT NULL,                     -- "Entretien", "Toiletries", "Linge", ...
  unit TEXT,                                  -- "pièce", "L", "kg"
  unit_price_mad NUMERIC(10,2),
  min_threshold NUMERIC(10,2) NOT NULL DEFAULT 0,
  default_order_qty NUMERIC(10,2),
  supplier TEXT,
  initial_stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_consumables_category_idx
  ON propria_consumables (category, name) WHERE is_active = true;

CREATE TRIGGER propria_consumables_updated_at BEFORE UPDATE ON propria_consumables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS propria_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumable_id UUID NOT NULL REFERENCES propria_consumables(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('entree','sortie','ajustement')),
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity NUMERIC(10,2) NOT NULL,            -- signé : positif=entrée, négatif=sortie
  unit_price_mad NUMERIC(10,2),
  source_destination TEXT,                    -- "ACHIBEST", "AF 1", ...
  property_id UUID REFERENCES properties(id), -- si sortie vers un bien
  responsible_id UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_stock_movements_consumable_idx
  ON propria_stock_movements (consumable_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS propria_stock_movements_property_idx
  ON propria_stock_movements (property_id) WHERE property_id IS NOT NULL;

-- Vue stock courant par consommable
CREATE OR REPLACE VIEW propria_stock_status AS
SELECT
  c.id,
  c.reference,
  c.name,
  c.category,
  c.unit,
  c.unit_price_mad,
  c.min_threshold,
  c.default_order_qty,
  c.supplier,
  c.initial_stock,
  COALESCE(m.total_entries, 0)::numeric  AS total_entries,
  COALESCE(m.total_exits, 0)::numeric    AS total_exits,
  (c.initial_stock + COALESCE(m.net_qty, 0))::numeric AS current_stock,
  ((c.initial_stock + COALESCE(m.net_qty, 0)) * COALESCE(c.unit_price_mad, 0))::numeric AS stock_value_mad,
  CASE
    WHEN (c.initial_stock + COALESCE(m.net_qty, 0)) <= 0 THEN 'rupture'
    WHEN (c.initial_stock + COALESCE(m.net_qty, 0)) < c.min_threshold THEN 'alerte'
    ELSE 'ok'
  END AS status,
  GREATEST(0, c.min_threshold - (c.initial_stock + COALESCE(m.net_qty, 0))) AS qty_to_order
FROM propria_consumables c
LEFT JOIN (
  SELECT
    consumable_id,
    SUM(CASE WHEN movement_type = 'entree' THEN quantity ELSE 0 END) AS total_entries,
    SUM(CASE WHEN movement_type = 'sortie' THEN quantity ELSE 0 END) AS total_exits,
    SUM(CASE
      WHEN movement_type = 'entree' THEN quantity
      WHEN movement_type = 'sortie' THEN -quantity
      ELSE quantity
    END) AS net_qty
  FROM propria_stock_movements
  GROUP BY consumable_id
) m ON m.consumable_id = c.id
WHERE c.is_active = true;

-- ─── 8. Réservations en espèces (Airbnb cash) ─────────────────────────────
CREATE TABLE IF NOT EXISTS propria_cash_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  voyageur_name TEXT,
  arrival_date DATE,
  departure_date DATE,
  nb_nights INTEGER,
  amount_mad NUMERIC(12,2) NOT NULL,
  assistant_id UUID REFERENCES profiles(id),    -- qui récupère le cash
  recovered_at DATE,
  recovered BOOLEAN NOT NULL DEFAULT false,
  remitted_to_ceo BOOLEAN NOT NULL DEFAULT false,
  remitted_at DATE,
  remitted_confirmed_by UUID REFERENCES profiles(id), -- doit être le CEO
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_cash_reservations_property_idx
  ON propria_cash_reservations (property_id, arrival_date DESC);
CREATE INDEX IF NOT EXISTS propria_cash_reservations_status_idx
  ON propria_cash_reservations (recovered, remitted_to_ceo);

CREATE TRIGGER propria_cash_reservations_updated_at BEFORE UPDATE ON propria_cash_reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 9. Transferts (aéroport / gare) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id),    -- bien associé (optionnel)
  travel_date DATE NOT NULL,
  voyageur_name TEXT,
  amount_mad NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN (
    'a_faire','fait','offert','anomalie','annule'
  )),
  bon_signe BOOLEAN NOT NULL DEFAULT false,
  bon_signe_path TEXT,                            -- justificatif scanné
  cash_collected BOOLEAN NOT NULL DEFAULT false,
  cash_remitted_at DATE,
  driver_name TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_transfers_date_idx
  ON propria_transfers (travel_date DESC);
CREATE INDEX IF NOT EXISTS propria_transfers_status_idx
  ON propria_transfers (status);

CREATE TRIGGER propria_transfers_updated_at BEFORE UPDATE ON propria_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 10. Inventaires de biens ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_inventories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  inventory_date DATE NOT NULL DEFAULT CURRENT_DATE,
  performed_by UUID REFERENCES profiles(id),
  type TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('general','entree','sortie','controle')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','termine')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_inventories_property_idx
  ON propria_inventories (property_id, inventory_date DESC);

CREATE TRIGGER propria_inventories_updated_at BEFORE UPDATE ON propria_inventories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS propria_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES propria_inventories(id) ON DELETE CASCADE,
  category TEXT,                  -- "Chambre 1", "Cuisine", "Salon"...
  name TEXT NOT NULL,
  quantity_expected INTEGER NOT NULL DEFAULT 1,
  quantity_found INTEGER,
  condition TEXT CHECK (condition IN ('neuf','bon','usage','endommage','manquant')),
  photo_paths TEXT[] DEFAULT '{}',
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_inventory_items_inv_idx
  ON propria_inventory_items (inventory_id);

-- ─── 11. Notes / avis annonces Airbnb / Booking ───────────────────────────
CREATE TABLE IF NOT EXISTS propria_listing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('airbnb','booking','vrbo','direct')),
  measured_at DATE NOT NULL DEFAULT CURRENT_DATE,
  rating NUMERIC(3,2),               -- 4.85
  nb_reviews INTEGER,
  occupancy_rate NUMERIC(5,2),       -- 0-100 (%)
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, platform, measured_at)
);

CREATE INDEX IF NOT EXISTS propria_listing_metrics_prop_idx
  ON propria_listing_metrics (property_id, platform, measured_at DESC);

-- ============================================================================
-- RLS — toutes les tables Propria sont accessibles au staff
-- ============================================================================
ALTER TABLE propria_providers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_intervention_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_interventions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_maintenance_visits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_wallet_dotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_wallet_expenses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_consumables         ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_stock_movements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_cash_reservations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_transfers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_inventories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_inventory_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE propria_listing_metrics     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'propria_providers','propria_intervention_types','propria_interventions',
    'propria_maintenance_visits','propria_wallets','propria_wallet_dotations',
    'propria_wallet_expenses','propria_consumables','propria_stock_movements',
    'propria_cash_reservations','propria_transfers','propria_inventories',
    'propria_inventory_items','propria_listing_metrics'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_read ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_read ON %I FOR SELECT USING (is_staff());',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_write ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_write ON %I FOR INSERT WITH CHECK (is_staff());',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_update ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_update ON %I FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_delete ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_delete ON %I FOR DELETE USING (is_staff(ARRAY[''ceo'',''chef_projet'']));',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================================
-- SEEDS — Types d'intervention par défaut
-- ============================================================================
INSERT INTO propria_intervention_types (name, category, display_order) VALUES
  ('Plomberie',        'Technique',   10),
  ('Électricité',      'Technique',   20),
  ('Climatisation',    'Technique',   30),
  ('Menuiserie',       'Technique',   40),
  ('WIFI / Internet',  'Technique',   50),
  ('Serrurerie',       'Sécurité',    60),
  ('Ménage renforcé',  'Entretien',   70),
  ('Jardinage',        'Entretien',   80),
  ('Désinfection',     'Entretien',   90),
  ('Peinture',         'Rénovation', 100),
  ('Mobilier / Déco',  'Aménagement',110),
  ('Transport',        'Divers',     120),
  ('Autre',            'Divers',     130)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- HELPERS — Génération maintenance préventive trimestrielle
-- ============================================================================

-- Renvoie la date de fin de trimestre pour une date donnée
CREATE OR REPLACE FUNCTION quarter_end_date(d DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('quarter', d) + interval '3 months - 1 day')::date;
$$;

CREATE OR REPLACE FUNCTION quarter_label(d DATE) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(d, 'YYYY') || '-Q' || EXTRACT(quarter FROM d)::text;
$$;

-- Fonction qui crée les visites de maintenance manquantes pour le trimestre courant
CREATE OR REPLACE FUNCTION propria_generate_maintenance_visits(target_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  q TEXT := quarter_label(target_date);
  due DATE := quarter_end_date(target_date);
  inserted_count INTEGER;
BEGIN
  WITH ins AS (
    INSERT INTO propria_maintenance_visits (property_id, quarter, due_date, status)
    SELECT
      p.id,
      q,
      due,
      CASE WHEN due < CURRENT_DATE THEN 'en_retard' ELSE 'a_planifier' END
    FROM properties p
    WHERE p.propria_managed_at IS NOT NULL
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM propria_maintenance_visits mv
        WHERE mv.property_id = p.id AND mv.quarter = q
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM ins;
  RETURN inserted_count;
END $$;

-- Grants RPC
GRANT EXECUTE ON FUNCTION propria_generate_maintenance_visits(DATE) TO authenticated;

-- Active security_invoker sur les vues (RLS appliquée à l'appelant, pas au créateur)
ALTER VIEW propria_interventions_enriched SET (security_invoker = on);
ALTER VIEW propria_wallet_balances        SET (security_invoker = on);
ALTER VIEW propria_stock_status           SET (security_invoker = on);

-- Audit triggers
DO $$
DECLARE tbl TEXT; tables TEXT[] := ARRAY[
  'propria_interventions','propria_maintenance_visits','propria_wallets',
  'propria_wallet_dotations','propria_wallet_expenses','propria_stock_movements',
  'propria_cash_reservations','propria_transfers'
];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger();',
      tbl, tbl
    );
  END LOOP;
END $$;
