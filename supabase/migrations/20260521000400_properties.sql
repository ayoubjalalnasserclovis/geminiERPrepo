-- ============================================================================
-- 04 — Properties + property_media
-- ============================================================================

CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status property_status NOT NULL DEFAULT 'sourcing',
  type TEXT CHECK (type IN ('Appartement','Riad','Terrain','Villa')),
  quartier TEXT,
  address TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  superficie NUMERIC(8,2),
  floor TEXT,
  nb_suites INTEGER,
  nb_lots_residence INTEGER,
  year_built INTEGER,
  exposure TEXT[] DEFAULT '{}',
  exterior TEXT[] DEFAULT '{}',
  has_elevator BOOLEAN NOT NULL DEFAULT false,
  has_parking BOOLEAN NOT NULL DEFAULT false,
  price NUMERIC(14,2),
  estimated_rent NUMERIC(14,2),
  agency_fees NUMERIC(14,2),
  notary_fees NUMERIC(14,2),
  stoniz_reduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  evaluation INTEGER CHECK (evaluation BETWEEN 1 AND 3),
  drive_url TEXT,
  conditions_offre TEXT,
  partner_id UUID REFERENCES partners(id),
  partner_agent_id UUID REFERENCES partner_agents(id),
  sourcing_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 2.5,
  sourcing_date DATE,
  first_visit_date DATE,
  offer_date DATE,
  sourced_by UUID REFERENCES profiles(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX properties_status_created_idx
  ON properties (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX properties_partner_status_idx
  ON properties (partner_id, status) WHERE deleted_at IS NULL;
CREATE INDEX properties_sourced_by_idx
  ON properties (sourced_by) WHERE deleted_at IS NULL;

CREATE TRIGGER properties_set_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Vue enrichie (avec dérivés calculés à la lecture) ──────────────────────
CREATE OR REPLACE VIEW properties_enriched AS
SELECT
  p.*,
  CASE WHEN p.price IS NOT NULL AND p.price > 0 AND p.estimated_rent IS NOT NULL
    THEN ROUND((p.estimated_rent * 12) / p.price * 100, 2)
    ELSE NULL END                                                      AS gross_yield,
  CASE WHEN p.price IS NOT NULL
    THEN ROUND(p.price * (p.sourcing_commission_rate / 100), 2)
    ELSE NULL END                                                      AS sourcing_commission_amount,
  CASE WHEN p.offer_date IS NOT NULL AND p.sourcing_date IS NOT NULL
    THEN (p.offer_date - p.sourcing_date)
    ELSE NULL END                                                      AS days_sourcing_to_offer
FROM properties p
WHERE p.deleted_at IS NULL;

-- ─── property_media ─────────────────────────────────────────────────────────
CREATE TABLE property_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('photo','video_bien','video_facade','video_parties_communes')),
  storage_path TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX property_media_cover_uniq
  ON property_media (property_id) WHERE is_cover = true;
CREATE INDEX property_media_property_order_idx
  ON property_media (property_id, display_order);
