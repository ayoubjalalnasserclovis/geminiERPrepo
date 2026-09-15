-- ============================================================================
-- Inventaires Propria — templates d'items standards (checklist)
-- ============================================================================
-- Objectif : que l'équipe terrain ne réfléchisse plus à QUOI inventorier.
-- Au démarrage d'un inventaire, on pré-remplit automatiquement tous les items
-- standards groupés par pièce. L'équipe n'a qu'à compléter quantité + état.
-- ============================================================================

CREATE TABLE IF NOT EXISTS propria_inventory_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                   -- "Cuisine", "Salon", "Chambre principale", etc.
  name TEXT NOT NULL,
  default_quantity INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS propria_inventory_template_items_category_idx
  ON propria_inventory_template_items (category, display_order)
  WHERE is_active = true;

CREATE TRIGGER propria_inventory_template_items_updated_at
  BEFORE UPDATE ON propria_inventory_template_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lien optionnel item d'inventaire ↔ item du template (traçabilité)
ALTER TABLE propria_inventory_items
  ADD COLUMN IF NOT EXISTS template_item_id UUID REFERENCES propria_inventory_template_items(id);

-- RLS — lecture pour staff Propria, modification CEO + chef_projet
ALTER TABLE propria_inventory_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS propria_inventory_template_items_staff_read ON propria_inventory_template_items;
CREATE POLICY propria_inventory_template_items_staff_read
  ON propria_inventory_template_items FOR SELECT
  USING (is_staff(ARRAY['ceo','chef_projet','assistante','propria']));

DROP POLICY IF EXISTS propria_inventory_template_items_admin_write ON propria_inventory_template_items;
CREATE POLICY propria_inventory_template_items_admin_write
  ON propria_inventory_template_items FOR INSERT
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet']));

DROP POLICY IF EXISTS propria_inventory_template_items_admin_update ON propria_inventory_template_items;
CREATE POLICY propria_inventory_template_items_admin_update
  ON propria_inventory_template_items FOR UPDATE
  USING (is_staff(ARRAY['ceo','chef_projet']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet']));

DROP POLICY IF EXISTS propria_inventory_template_items_admin_delete ON propria_inventory_template_items;
CREATE POLICY propria_inventory_template_items_admin_delete
  ON propria_inventory_template_items FOR DELETE
  USING (is_staff(ARRAY['ceo']));

-- ============================================================================
-- SEED — Items standards d'un Airbnb meublé clé en main marocain
-- ============================================================================
-- Si déjà seedé (re-run de la migration), on skip.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM propria_inventory_template_items LIMIT 1) THEN
    INSERT INTO propria_inventory_template_items (category, name, default_quantity, display_order) VALUES

    -- ─── Entrée ─────────────────────────────────────────────────────
    ('Entrée', 'Paillasson',                1,  10),
    ('Entrée', 'Porte-manteau / patère',    1,  20),
    ('Entrée', 'Plateau vide-poches',       1,  30),

    -- ─── Salon ──────────────────────────────────────────────────────
    ('Salon', 'Canapé',                     1, 100),
    ('Salon', 'Fauteuil',                   2, 110),
    ('Salon', 'Table basse',                1, 120),
    ('Salon', 'Coussins',                   4, 130),
    ('Salon', 'Plaid / couverture déco',    1, 140),
    ('Salon', 'TV',                         1, 150),
    ('Salon', 'Télécommande TV',            1, 160),
    ('Salon', 'Box internet / décodeur',    1, 170),
    ('Salon', 'Tapis',                      1, 180),
    ('Salon', 'Lampe / luminaire',          2, 190),
    ('Salon', 'Tableau / déco murale',      2, 200),

    -- ─── Cuisine — équipements ──────────────────────────────────────
    ('Cuisine', 'Réfrigérateur',            1, 300),
    ('Cuisine', 'Plaque de cuisson',        1, 310),
    ('Cuisine', 'Four',                     1, 320),
    ('Cuisine', 'Micro-ondes',              1, 330),
    ('Cuisine', 'Hotte aspirante',          1, 340),
    ('Cuisine', 'Cafetière',                1, 350),
    ('Cuisine', 'Bouilloire',               1, 360),
    ('Cuisine', 'Grille-pain',              1, 370),
    -- ─── Cuisine — ustensiles ───────────────────────────────────────
    ('Cuisine', 'Casseroles',               3, 380),
    ('Cuisine', 'Poêles',                   2, 390),
    ('Cuisine', 'Faitout / cocotte',        1, 400),
    ('Cuisine', 'Tajine',                   1, 410),
    ('Cuisine', 'Couteaux de cuisine',      4, 420),
    ('Cuisine', 'Spatules / louches',       4, 430),
    ('Cuisine', 'Planche à découper',       2, 440),
    ('Cuisine', 'Passoire',                 1, 450),
    ('Cuisine', 'Saladier',                 2, 460),
    -- ─── Cuisine — vaisselle ────────────────────────────────────────
    ('Cuisine', 'Assiettes plates',         8, 500),
    ('Cuisine', 'Assiettes creuses',        8, 510),
    ('Cuisine', 'Assiettes à dessert',      8, 520),
    ('Cuisine', 'Bols',                     6, 530),
    ('Cuisine', 'Tasses à café',            6, 540),
    ('Cuisine', 'Tasses à thé',             6, 550),
    ('Cuisine', 'Verres à eau',             8, 560),
    ('Cuisine', 'Verres à vin',             6, 570),
    -- ─── Cuisine — couverts ────────────────────────────────────────
    ('Cuisine', 'Fourchettes',              8, 600),
    ('Cuisine', 'Couteaux de table',        8, 610),
    ('Cuisine', 'Cuillères à soupe',        8, 620),
    ('Cuisine', 'Petites cuillères',        8, 630),
    -- ─── Cuisine — accessoires ─────────────────────────────────────
    ('Cuisine', 'Théière marocaine',        1, 700),
    ('Cuisine', 'Service à thé (verres)',   6, 710),
    ('Cuisine', 'Plateau de service',       1, 720),
    ('Cuisine', 'Salière + poivrière',      1, 730),
    ('Cuisine', 'Torchons',                 4, 740),

    -- ─── Salle à manger ─────────────────────────────────────────────
    ('Salle à manger', 'Table à manger',    1, 800),
    ('Salle à manger', 'Chaises',           6, 810),
    ('Salle à manger', 'Sets de table',     6, 820),

    -- ─── Chambre principale ────────────────────────────────────────
    ('Chambre principale', 'Lit (sommier + matelas)', 1, 900),
    ('Chambre principale', 'Oreillers',     4,  910),
    ('Chambre principale', 'Couette / édredon', 1, 920),
    ('Chambre principale', 'Couvre-lit / plaid', 1, 930),
    ('Chambre principale', 'Jeux de draps complets', 2, 940),
    ('Chambre principale', 'Tables de chevet', 2, 950),
    ('Chambre principale', 'Lampes de chevet', 2, 960),
    ('Chambre principale', 'Armoire / dressing', 1, 970),
    ('Chambre principale', 'Cintres',       10, 980),
    ('Chambre principale', 'Miroir',        1, 990),
    ('Chambre principale', 'Rideaux / voilage', 1, 1000),
    ('Chambre principale', 'Tapis',         1, 1010),

    -- ─── Chambre 2 (optionnelle) ───────────────────────────────────
    ('Chambre 2', 'Lit (sommier + matelas)', 1, 1100),
    ('Chambre 2', 'Oreillers',              2, 1110),
    ('Chambre 2', 'Couette / édredon',      1, 1120),
    ('Chambre 2', 'Jeux de draps complets', 2, 1130),
    ('Chambre 2', 'Table de chevet',        1, 1140),
    ('Chambre 2', 'Lampe de chevet',        1, 1150),
    ('Chambre 2', 'Armoire',                1, 1160),
    ('Chambre 2', 'Cintres',                8, 1170),
    ('Chambre 2', 'Rideaux / voilage',      1, 1180),

    -- ─── Chambre 3 (optionnelle) ───────────────────────────────────
    ('Chambre 3', 'Lit (sommier + matelas)', 1, 1200),
    ('Chambre 3', 'Oreillers',              2, 1210),
    ('Chambre 3', 'Jeux de draps complets', 2, 1220),
    ('Chambre 3', 'Table de chevet',        1, 1230),
    ('Chambre 3', 'Armoire',                1, 1240),

    -- ─── Salle de bain principale ──────────────────────────────────
    ('Salle de bain principale', 'Serviettes de bain', 4, 1300),
    ('Salle de bain principale', 'Serviettes invité', 4, 1310),
    ('Salle de bain principale', 'Tapis de bain', 1, 1320),
    ('Salle de bain principale', 'Sèche-cheveux', 1, 1330),
    ('Salle de bain principale', 'Miroir', 1, 1340),
    ('Salle de bain principale', 'Porte-serviettes', 1, 1350),
    ('Salle de bain principale', 'Distributeur savon', 1, 1360),
    ('Salle de bain principale', 'Poubelle', 1, 1370),

    -- ─── Salle de bain 2 (optionnelle) ─────────────────────────────
    ('Salle de bain 2', 'Serviettes de bain', 2, 1400),
    ('Salle de bain 2', 'Tapis de bain', 1, 1410),
    ('Salle de bain 2', 'Miroir', 1, 1420),
    ('Salle de bain 2', 'Distributeur savon', 1, 1430),
    ('Salle de bain 2', 'Poubelle', 1, 1440),

    -- ─── Toilettes ──────────────────────────────────────────────────
    ('Toilettes', 'Brosse WC', 1, 1500),
    ('Toilettes', 'Balai brosse', 1, 1510),
    ('Toilettes', 'Poubelle', 1, 1520),
    ('Toilettes', 'Distributeur PQ', 1, 1530),

    -- ─── Buanderie / Lingerie ──────────────────────────────────────
    ('Buanderie', 'Lave-linge', 1, 1600),
    ('Buanderie', 'Fer à repasser', 1, 1610),
    ('Buanderie', 'Planche à repasser', 1, 1620),
    ('Buanderie', 'Étendoir', 1, 1630),
    ('Buanderie', 'Aspirateur', 1, 1640),
    ('Buanderie', 'Balai + pelle', 1, 1650),
    ('Buanderie', 'Serpillière + seau', 1, 1660),
    ('Buanderie', 'Stock draps (jeux complets)', 3, 1670),
    ('Buanderie', 'Stock serviettes bain', 6, 1680),
    ('Buanderie', 'Stock torchons', 6, 1690),

    -- ─── Terrasse / Balcon (optionnelle) ───────────────────────────
    ('Terrasse', 'Salon de jardin', 1, 1700),
    ('Terrasse', 'Chaises extérieur', 4, 1710),
    ('Terrasse', 'Parasol', 1, 1720),
    ('Terrasse', 'Coussins extérieur', 4, 1730),
    ('Terrasse', 'Bain de soleil', 2, 1740),

    -- ─── Sécurité & accès ──────────────────────────────────────────
    ('Sécurité & accès', 'Trousseau de clés principal', 1, 1800),
    ('Sécurité & accès', 'Trousseau de clés backup', 1, 1810),
    ('Sécurité & accès', 'Badge immeuble', 1, 1820),
    ('Sécurité & accès', 'Badge ascenseur', 1, 1830),
    ('Sécurité & accès', 'Télécommande parking', 1, 1840),
    ('Sécurité & accès', 'Détecteur de fumée', 2, 1850),
    ('Sécurité & accès', 'Extincteur', 1, 1860),
    ('Sécurité & accès', 'Trousse premiers secours', 1, 1870);
  END IF;
END $$;

COMMENT ON TABLE propria_inventory_template_items IS
  'Catalogue d''items standards à inventorier dans un Airbnb meublé. Utilisé pour pré-remplir les inventaires.';
