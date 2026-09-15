-- ============================================================================
-- VCT (Visite Contrôle Technique) + PV de réception
-- ============================================================================
-- Workflow :
--   Phase Travaux → [chef projet déclare "chantier terminé"] → Phase Livraison
--   Livraison :
--     1. VCT auto-créée + checklist pré-remplie (~80 items)
--     2. Chef projet fait la VCT mobile, identifie actions correctives
--     3. Actions correctives → encart séparé sur fiche projet
--     4. Artisans corrigent → VCT validée
--     5. PV de réception créé, checklist héritée de la VCT
--     6. Client signe e-électroniquement → PV validé
--   Livraison → Mise en location : gate sur pv.status = 'validated'
-- ============================================================================

-- ─── 1. Template d'items (catalogue partagé VCT + PV) ──────────────────────
CREATE TABLE IF NOT EXISTS project_reception_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,             -- "Peintures", "Sols", "Électricité", etc.
  name TEXT NOT NULL,                 -- "Pas de traces / coulures peinture salon"
  default_quantity INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_reception_template_items_cat_idx
  ON project_reception_template_items (category, display_order)
  WHERE is_active = true;
CREATE TRIGGER project_reception_template_items_updated_at
  BEFORE UPDATE ON project_reception_template_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. VCT — Visite Contrôle Technique (interne, par chef projet) ────────
CREATE TABLE IF NOT EXISTS project_vct (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',                    -- créée mais pas commencée
    'in_progress',              -- chef projet remplit en cours
    'with_actions',             -- finie mais actions correctives ouvertes
    'validated'                 -- toutes actions résolues
  )),
  performed_by UUID REFERENCES profiles(id),
  performed_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  internal_notes TEXT,                -- notes internes Stoniz
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_vct_project_idx ON project_vct (project_id);
CREATE INDEX IF NOT EXISTS project_vct_status_idx ON project_vct (status);
CREATE TRIGGER project_vct_updated_at
  BEFORE UPDATE ON project_vct
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Items VCT (points d'inspection, pré-remplis du template) ──────────
CREATE TABLE IF NOT EXISTS project_vct_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vct_id UUID NOT NULL REFERENCES project_vct(id) ON DELETE CASCADE,
  template_item_id UUID REFERENCES project_reception_template_items(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT CHECK (status IN ('ok','defaut_mineur','defaut_bloquant') OR status IS NULL),
  observations TEXT,
  photo_paths TEXT[] DEFAULT '{}',
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_vct_items_vct_idx ON project_vct_items (vct_id, display_order);
CREATE TRIGGER project_vct_items_updated_at
  BEFORE UPDATE ON project_vct_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 4. Actions correctives VCT (issues à corriger) ───────────────────────
CREATE TABLE IF NOT EXISTS project_vct_corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vct_id UUID NOT NULL REFERENCES project_vct(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vct_item_id UUID REFERENCES project_vct_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  artisan_id UUID REFERENCES artisans(id),     -- artisan en charge (peut être null si Stoniz)
  responsible_role TEXT CHECK (responsible_role IN ('stoniz','artisan') OR responsible_role IS NULL),
  deadline DATE,
  photo_paths TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',           -- à corriger
    'in_progress',    -- artisan/Stoniz au travail
    'resolved',       -- corrigé, en attente de re-vérification
    'verified',       -- chef projet a vérifié la correction
    'cancelled'       -- annulée (ex: faux positif)
  )),
  notified_at TIMESTAMPTZ,             -- quand l'artisan a été notifié (WhatsApp)
  notified_via TEXT,                   -- 'whatsapp', 'manual', 'email', etc.
  resolved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES profiles(id),
  intervention_id UUID REFERENCES propria_interventions(id),  -- si convertie en intervention payante
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_vct_actions_vct_idx ON project_vct_corrective_actions (vct_id);
CREATE INDEX IF NOT EXISTS project_vct_actions_project_idx ON project_vct_corrective_actions (project_id, status);
CREATE INDEX IF NOT EXISTS project_vct_actions_artisan_idx ON project_vct_corrective_actions (artisan_id) WHERE artisan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_vct_actions_open_idx ON project_vct_corrective_actions (status, deadline) WHERE status IN ('open','in_progress','resolved');
CREATE TRIGGER project_vct_actions_updated_at
  BEFORE UPDATE ON project_vct_corrective_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 5. PV de réception (contradictoire avec client) ──────────────────────
CREATE TABLE IF NOT EXISTS project_reception_pvs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  vct_id UUID REFERENCES project_vct(id),     -- VCT source dont est dérivé le PV
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',                  -- en cours de remplissage staff
    'sent_to_client',         -- envoyé au client pour signature
    'validated',              -- client a signé électroniquement
    'rejected',               -- client a refusé / contesté (rare)
    'closed'                  -- réserves levées, dossier clos
  )),
  reception_date DATE,
  weather_conditions TEXT,
  parties_stoniz TEXT,                 -- noms côté Stoniz présents
  parties_client TEXT,                 -- noms côté client présents
  general_observations TEXT,
  -- Compteurs au jour J (important pour transition Propria)
  meter_electricity_reading TEXT,
  meter_water_reading TEXT,
  meter_gas_reading TEXT,
  -- Documents remis (JSON pour souplesse : plans, factures, garanties…)
  documents_handed_over JSONB NOT NULL DEFAULT '[]',
  -- Clés remises
  keys_count INTEGER,
  keys_details TEXT,
  -- Note satisfaction immédiate (1-5)
  client_satisfaction_rating INTEGER CHECK (client_satisfaction_rating BETWEEN 1 AND 5),
  -- Signature électronique
  client_signed_at TIMESTAMPTZ,
  client_signed_ip TEXT,
  client_signed_user_agent TEXT,
  client_signed_full_name TEXT,        -- copie du nom au moment de la signature
  -- PDF généré
  pdf_path TEXT,                       -- storage path
  pdf_generated_at TIMESTAMPTZ,
  -- Métadonnées
  prepared_by UUID REFERENCES profiles(id),
  sent_to_client_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_reception_pvs_project_idx ON project_reception_pvs (project_id);
CREATE INDEX IF NOT EXISTS project_reception_pvs_status_idx ON project_reception_pvs (status);
CREATE TRIGGER project_reception_pvs_updated_at
  BEFORE UPDATE ON project_reception_pvs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6. Items PV (points du PV, dérivés de la VCT) ────────────────────────
CREATE TABLE IF NOT EXISTS project_reception_pv_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id UUID NOT NULL REFERENCES project_reception_pvs(id) ON DELETE CASCADE,
  template_item_id UUID REFERENCES project_reception_template_items(id),
  vct_item_id UUID REFERENCES project_vct_items(id),     -- traçabilité avec la VCT source
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT CHECK (status IN ('ok','reserve','refus') OR status IS NULL),
  observations TEXT,
  photo_paths TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_reception_pv_items_pv_idx ON project_reception_pv_items (pv_id, display_order);
CREATE TRIGGER project_reception_pv_items_updated_at
  BEFORE UPDATE ON project_reception_pv_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 7. Réserves PV (les points contradictoirement listés au PV) ──────────
CREATE TABLE IF NOT EXISTS project_reception_pv_reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id UUID NOT NULL REFERENCES project_reception_pvs(id) ON DELETE CASCADE,
  pv_item_id UUID REFERENCES project_reception_pv_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  artisan_id UUID REFERENCES artisans(id),
  responsible_role TEXT CHECK (responsible_role IN ('stoniz','artisan','client') OR responsible_role IS NULL),
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted_as_is')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_reception_pv_reserves_pv_idx ON project_reception_pv_reserves (pv_id, status);
CREATE TRIGGER project_reception_pv_reserves_updated_at
  BEFORE UPDATE ON project_reception_pv_reserves
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE project_reception_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_vct ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_vct_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_vct_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reception_pvs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reception_pv_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reception_pv_reserves ENABLE ROW LEVEL SECURITY;

-- Staff (ceo, chef_projet) en lecture/écriture sur tout
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'project_reception_template_items',
    'project_vct','project_vct_items','project_vct_corrective_actions',
    'project_reception_pvs','project_reception_pv_items','project_reception_pv_reserves'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_read ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_read ON %I FOR SELECT USING (is_staff(ARRAY[''ceo'',''chef_projet'',''finance'',''assistante'']));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_write ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_write ON %I FOR INSERT WITH CHECK (is_staff(ARRAY[''ceo'',''chef_projet'']));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_update ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_update ON %I FOR UPDATE USING (is_staff(ARRAY[''ceo'',''chef_projet''])) WITH CHECK (is_staff(ARRAY[''ceo'',''chef_projet'']));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_delete ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_staff_delete ON %I FOR DELETE USING (is_staff(ARRAY[''ceo'']));',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Le CLIENT peut LIRE et UPDATE son propre PV (pour signature)
DROP POLICY IF EXISTS project_reception_pvs_client_read ON project_reception_pvs;
CREATE POLICY project_reception_pvs_client_read
  ON project_reception_pvs FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE client_id IN (
        SELECT id FROM clients WHERE profile_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS project_reception_pvs_client_sign ON project_reception_pvs;
CREATE POLICY project_reception_pvs_client_sign
  ON project_reception_pvs FOR UPDATE
  USING (
    status = 'sent_to_client'
    AND project_id IN (
      SELECT id FROM projects WHERE client_id IN (
        SELECT id FROM clients WHERE profile_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    status IN ('sent_to_client','validated')
    AND project_id IN (
      SELECT id FROM projects WHERE client_id IN (
        SELECT id FROM clients WHERE profile_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS project_reception_pv_items_client_read ON project_reception_pv_items;
CREATE POLICY project_reception_pv_items_client_read
  ON project_reception_pv_items FOR SELECT
  USING (
    pv_id IN (
      SELECT id FROM project_reception_pvs WHERE project_id IN (
        SELECT id FROM projects WHERE client_id IN (
          SELECT id FROM clients WHERE profile_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS project_reception_pv_reserves_client_read ON project_reception_pv_reserves;
CREATE POLICY project_reception_pv_reserves_client_read
  ON project_reception_pv_reserves FOR SELECT
  USING (
    pv_id IN (
      SELECT id FROM project_reception_pvs WHERE project_id IN (
        SELECT id FROM projects WHERE client_id IN (
          SELECT id FROM clients WHERE profile_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- Audit triggers
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'project_vct','project_vct_items','project_vct_corrective_actions',
    'project_reception_pvs','project_reception_pv_items','project_reception_pv_reserves'
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

-- ============================================================================
-- Gate de phase : Livraison → Mise en location interdit tant que PV non validé
-- ============================================================================
-- On modifie le check de phase advance pour exiger un PV validé.
-- Cette fonction est appelée par advance_project_phase (cf migrations 002700+).
CREATE OR REPLACE FUNCTION check_pv_validated_for_mise_en_location(p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_pv_status TEXT;
BEGIN
  SELECT status INTO v_pv_status
  FROM project_reception_pvs
  WHERE project_id = p_project_id
  LIMIT 1;

  IF v_pv_status IS NULL THEN
    RETURN 'Le PV de réception n''a pas encore été créé pour ce projet.';
  END IF;
  IF v_pv_status NOT IN ('validated','closed') THEN
    RETURN 'Le PV de réception doit être validé par le client avant de passer en mise en location (statut actuel : ' || v_pv_status || ').';
  END IF;
  RETURN NULL;  -- aucun blocage
END;
$$;

COMMENT ON FUNCTION check_pv_validated_for_mise_en_location IS
  'Retourne NULL si le PV est validé/clos (passage en mise_en_location autorisé), sinon un message d''erreur explicite.';

-- ============================================================================
-- SEED — Items standards d'une réception de bien meublé clé en main
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project_reception_template_items LIMIT 1) THEN
    INSERT INTO project_reception_template_items (category, name, display_order) VALUES

    -- ─── Peintures & murs ──────────────────────────────────────────
    ('Peintures & murs', 'Murs salon — pas de coulures / traces', 100),
    ('Peintures & murs', 'Murs chambres — pas de coulures / traces', 110),
    ('Peintures & murs', 'Murs cuisine — pas de coulures / traces', 120),
    ('Peintures & murs', 'Murs SDB / toilettes — pas de coulures', 130),
    ('Peintures & murs', 'Plafonds tous niveaux', 140),
    ('Peintures & murs', 'Plinthes posées et peintes', 150),
    ('Peintures & murs', 'Angles propres (pas de bavures)', 160),

    -- ─── Sols ──────────────────────────────────────────────────────
    ('Sols', 'Parquet / carrelage salon — pose conforme', 200),
    ('Sols', 'Carrelage cuisine — joints propres', 210),
    ('Sols', 'Carrelage SDB / toilettes — étanchéité', 220),
    ('Sols', 'Sols chambres — pose conforme', 230),
    ('Sols', 'Sols entrée / couloirs', 240),
    ('Sols', 'Aucun carreau cassé / rayé', 250),

    -- ─── Menuiseries ───────────────────────────────────────────────
    ('Menuiseries', 'Portes intérieures — ouverture / fermeture OK', 300),
    ('Menuiseries', 'Portes intérieures — poignées installées', 310),
    ('Menuiseries', 'Porte d''entrée — serrure 5 points OK', 320),
    ('Menuiseries', 'Fenêtres — étanchéité', 330),
    ('Menuiseries', 'Volets / persiennes — fonctionnement', 340),
    ('Menuiseries', 'Placards / dressing — portes et étagères', 350),
    ('Menuiseries', 'Cuisine — façades meubles fonctionnelles', 360),

    -- ─── Plomberie ─────────────────────────────────────────────────
    ('Plomberie', 'Évier cuisine — écoulement', 400),
    ('Plomberie', 'Lavabos SDB — écoulement', 410),
    ('Plomberie', 'WC — chasse d''eau fonctionnelle', 420),
    ('Plomberie', 'WC — pas de fuite à la base', 430),
    ('Plomberie', 'Douche — étanchéité bac', 440),
    ('Plomberie', 'Baignoire — étanchéité', 450),
    ('Plomberie', 'Robinets — pression eau chaude / froide', 460),
    ('Plomberie', 'Chauffe-eau — fonctionnement', 470),
    ('Plomberie', 'Évacuations machine à laver', 480),
    ('Plomberie', 'Aucune fuite visible sous éviers / lavabos', 490),

    -- ─── Électricité ───────────────────────────────────────────────
    ('Électricité', 'Tableau électrique — disjoncteurs étiquetés', 500),
    ('Électricité', 'Prises de courant — toutes fonctionnelles', 510),
    ('Électricité', 'Interrupteurs — tous fonctionnels', 520),
    ('Électricité', 'Luminaires salon / chambres', 530),
    ('Électricité', 'Luminaires cuisine / SDB', 540),
    ('Électricité', 'Prises USB / RJ45 si prévues', 550),
    ('Électricité', 'Mise à la terre vérifiée', 560),
    ('Électricité', 'Sonnette / interphone fonctionnel', 570),

    -- ─── Climatisation / VMC ───────────────────────────────────────
    ('Climatisation & VMC', 'Climatisation salon — démarrage froid/chaud', 600),
    ('Climatisation & VMC', 'Climatisation chambres', 610),
    ('Climatisation & VMC', 'VMC — extraction SDB / cuisine', 620),
    ('Climatisation & VMC', 'Télécommandes clim fournies', 630),

    -- ─── Cuisine équipée ───────────────────────────────────────────
    ('Cuisine équipée', 'Plaque de cuisson — tous feux OK', 700),
    ('Cuisine équipée', 'Four — montée en température', 710),
    ('Cuisine équipée', 'Hotte aspirante — extraction', 720),
    ('Cuisine équipée', 'Réfrigérateur — froid OK', 730),
    ('Cuisine équipée', 'Lave-vaisselle si prévu', 740),
    ('Cuisine équipée', 'Plan de travail — pas de rayures / éclats', 750),
    ('Cuisine équipée', 'Crédence — joints propres', 760),

    -- ─── Salles de bain ────────────────────────────────────────────
    ('Salles de bain', 'Miroirs posés droits', 800),
    ('Salles de bain', 'Porte-serviettes installés', 810),
    ('Salles de bain', 'Accessoires (savon, papier toilette)', 820),
    ('Salles de bain', 'Pommeau de douche / mitigeur', 830),
    ('Salles de bain', 'Joints silicone propres', 840),

    -- ─── Mobilier & déco (clé en main) ────────────────────────────
    ('Mobilier & déco', 'Lits livrés et montés', 900),
    ('Mobilier & déco', 'Matelas + literie complète', 910),
    ('Mobilier & déco', 'Canapé + fauteuils livrés', 920),
    ('Mobilier & déco', 'Table à manger + chaises', 930),
    ('Mobilier & déco', 'Rideaux / voilages installés', 940),
    ('Mobilier & déco', 'Tableaux / déco murale fixés', 950),
    ('Mobilier & déco', 'Tapis livrés', 960),
    ('Mobilier & déco', 'Luminaires décoratifs installés', 970),
    ('Mobilier & déco', 'Vaisselle / petits équipements cuisine', 980),

    -- ─── Sécurité & accès ──────────────────────────────────────────
    ('Sécurité & accès', 'Trousseaux de clés complets remis', 1000),
    ('Sécurité & accès', 'Badges immeuble / ascenseur remis', 1010),
    ('Sécurité & accès', 'Code interphone communiqué', 1020),
    ('Sécurité & accès', 'Détecteur de fumée installé', 1030),
    ('Sécurité & accès', 'Extincteur (si applicable)', 1040),
    ('Sécurité & accès', 'Caméras (si applicable) — fonctionnement', 1050),

    -- ─── Documents & garanties ─────────────────────────────────────
    ('Documents & garanties', 'Plans définitifs remis', 1100),
    ('Documents & garanties', 'Factures travaux remises (PDF)', 1110),
    ('Documents & garanties', 'Garanties décennales artisans', 1120),
    ('Documents & garanties', 'Notices appareils électroménagers', 1130),
    ('Documents & garanties', 'Contrats fournitures (EDF, eau, internet)', 1140),
    ('Documents & garanties', 'Code Wifi communiqué', 1150),

    -- ─── Compteurs (relevés) ───────────────────────────────────────
    ('Compteurs', 'Relevé compteur électricité', 1200),
    ('Compteurs', 'Relevé compteur eau', 1210),
    ('Compteurs', 'Relevé compteur gaz (si applicable)', 1220),

    -- ─── Propreté finale ───────────────────────────────────────────
    ('Propreté finale', 'Nettoyage de fin de chantier effectué', 1300),
    ('Propreté finale', 'Pas de déchets de chantier restants', 1310),
    ('Propreté finale', 'Vitres / miroirs propres', 1320),
    ('Propreté finale', 'Sols dépoussiérés / lavés', 1330);
  END IF;
END $$;

COMMENT ON TABLE project_reception_template_items IS
  'Catalogue d''items standards pour VCT et PV de réception. Partagé entre les deux.';
COMMENT ON TABLE project_vct IS
  'Visite Contrôle Technique : inspection INTERNE chef projet avant la livraison client.';
COMMENT ON TABLE project_reception_pvs IS
  'Procès-Verbal de réception : signature contradictoire avec le client. Déclenche garanties.';
