-- ============================================================================
-- DEMO SEED — Module Propria
-- Idempotent : DELETE puis INSERT. Tag '[PROPRIA-DEMO]' utilisé pour cleanup.
-- ============================================================================

-- ─── Cleanup ────────────────────────────────────────────────────────────────
DELETE FROM propria_inventory_items
  WHERE inventory_id IN (SELECT id FROM propria_inventories WHERE notes LIKE '[PROPRIA-DEMO]%');
DELETE FROM propria_inventories       WHERE notes LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_listing_metrics   WHERE notes LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_transfers         WHERE comment LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_cash_reservations WHERE observations LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_stock_movements   WHERE notes LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_consumables       WHERE notes LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_wallet_expenses
  WHERE wallet_id IN (SELECT id FROM propria_wallets WHERE notes LIKE '[PROPRIA-DEMO]%');
DELETE FROM propria_wallet_dotations
  WHERE wallet_id IN (SELECT id FROM propria_wallets WHERE notes LIKE '[PROPRIA-DEMO]%');
DELETE FROM propria_wallets           WHERE notes LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_maintenance_visits
  WHERE property_id IN (SELECT id FROM properties WHERE propria_observations LIKE '[PROPRIA-DEMO]%');
DELETE FROM propria_interventions     WHERE observations LIKE '[PROPRIA-DEMO]%';
DELETE FROM propria_providers         WHERE notes LIKE '[PROPRIA-DEMO]%';
-- Biens externes demo (créés via Propria, pas liés à un projet Stoniz)
DELETE FROM properties
  WHERE propria_observations LIKE '[PROPRIA-DEMO]%'
    AND id NOT IN (SELECT property_id FROM projects WHERE property_id IS NOT NULL);
-- Désactiver Propria sur les biens Stoniz tagués demo
UPDATE properties
  SET propria_managed_at = NULL, propria_observations = NULL
  WHERE propria_observations LIKE '[PROPRIA-DEMO]%';

-- ─── Seed ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_ceo_id       UUID;
  v_chef_id      UUID;
  v_finance_id   UUID;
  v_assist_id    UUID;
  v_assist2_id   UUID;

  v_prov_abdellatif UUID;
  v_prov_zakaria    UUID;
  v_prov_said       UUID;
  v_prov_yassin     UUID;
  v_prov_ali        UUID;
  v_prov_mehdi      UUID;
  v_prov_jawad      UUID;

  v_type_plomb      UUID;
  v_type_elec       UUID;
  v_type_clim       UUID;
  v_type_menuiserie UUID;
  v_type_wifi       UUID;
  v_type_serrurerie UUID;
  v_type_menage     UUID;
  v_type_peinture   UUID;

  v_bien_majorelle  UUID;
  v_bien_atlas      UUID;
  v_bien_palmeraie  UUID;
  v_bien_af1        UUID;
  v_bien_af2        UUID;
  v_bien_majo1      UUID;
  v_bien_majo2      UUID;
  v_bien_majo3      UUID;
  v_bien_warda3     UUID;
  v_bien_steven1    UUID;
  v_bien_catherine1 UUID;
  v_bien_paul1      UUID;
  v_bien_duc1       UUID;
  v_bien_habib1     UUID;
  v_bien_joundy3    UUID;

  v_wallet_assist1  UUID;
  v_wallet_assist2  UUID;
  v_wallet_chef     UUID;

  v_consum_liq_vais UUID;
  v_consum_sacs     UUID;
  v_consum_papier   UUID;
  v_consum_shampoo  UUID;

  v_visit_id        UUID;
BEGIN
  -- ─── Acteurs ──────────────────────────────────────────────────────────────
  SELECT id INTO v_ceo_id     FROM profiles WHERE role = 'ceo'         AND is_active LIMIT 1;
  SELECT id INTO v_chef_id    FROM profiles WHERE role = 'chef_projet' AND is_active LIMIT 1;
  SELECT id INTO v_finance_id FROM profiles WHERE role = 'finance'     AND is_active LIMIT 1;
  SELECT id INTO v_assist_id  FROM profiles WHERE role = 'assistante'  AND is_active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_assist2_id FROM profiles WHERE role = 'assistante'  AND is_active AND id <> COALESCE(v_assist_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY created_at LIMIT 1;

  IF v_chef_id    IS NULL THEN v_chef_id    := v_ceo_id; END IF;
  IF v_finance_id IS NULL THEN v_finance_id := v_ceo_id; END IF;
  IF v_assist_id  IS NULL THEN v_assist_id  := v_ceo_id; END IF;
  IF v_assist2_id IS NULL THEN v_assist2_id := v_assist_id; END IF;

  IF v_ceo_id IS NULL THEN
    RAISE NOTICE 'Aucun profil staff trouve - propria demo seed skip';
    RETURN;
  END IF;

  -- ─── Prestataires externes ────────────────────────────────────────────────
  INSERT INTO propria_providers (name, function, phone, indicative_rate, notes) VALUES
    ('Abdellatif Oubenali',  'Tout corps',        '+212 6 09 07 68 05', '150 DH/h', '[PROPRIA-DEMO] Référent multi-services'),
    ('Zakaria Clim',          'Climatisation',     '+212 7 60 26 02 63', 'Forfait mensuel 800 DH', '[PROPRIA-DEMO]'),
    ('Said Ménage',           'Ménage renforcé',   '+212 6 99 83 12 96', '120 DH/intervention', '[PROPRIA-DEMO]'),
    ('Yassin Technicien',     'Électricité',       '+212 6 15 60 51 72', '180 DH/h', '[PROPRIA-DEMO]'),
    ('Ali Serrurier',         'Serrurerie',        '+212 6 73 26 45 70', '200 DH déplacement', '[PROPRIA-DEMO]'),
    ('Mehdi Plomberie',       'Plomberie',         '+212 6 38 87 51 86', '160 DH/h', '[PROPRIA-DEMO]'),
    ('Jawad Peinture',        'Peinture',          '+212 6 68 02 27 26', 'Sur devis', '[PROPRIA-DEMO]');

  SELECT id INTO v_prov_abdellatif FROM propria_providers WHERE name = 'Abdellatif Oubenali';
  SELECT id INTO v_prov_zakaria    FROM propria_providers WHERE name = 'Zakaria Clim';
  SELECT id INTO v_prov_said       FROM propria_providers WHERE name = 'Said Ménage';
  SELECT id INTO v_prov_yassin     FROM propria_providers WHERE name = 'Yassin Technicien';
  SELECT id INTO v_prov_ali        FROM propria_providers WHERE name = 'Ali Serrurier';
  SELECT id INTO v_prov_mehdi      FROM propria_providers WHERE name = 'Mehdi Plomberie';
  SELECT id INTO v_prov_jawad      FROM propria_providers WHERE name = 'Jawad Peinture';

  -- ─── Types d'intervention (déjà seedés par migration) ────────────────────
  SELECT id INTO v_type_plomb      FROM propria_intervention_types WHERE name = 'Plomberie';
  SELECT id INTO v_type_elec       FROM propria_intervention_types WHERE name = 'Électricité';
  SELECT id INTO v_type_clim       FROM propria_intervention_types WHERE name = 'Climatisation';
  SELECT id INTO v_type_menuiserie FROM propria_intervention_types WHERE name = 'Menuiserie';
  SELECT id INTO v_type_wifi       FROM propria_intervention_types WHERE name = 'WIFI / Internet';
  SELECT id INTO v_type_serrurerie FROM propria_intervention_types WHERE name = 'Serrurerie';
  SELECT id INTO v_type_menage     FROM propria_intervention_types WHERE name = 'Ménage renforcé';
  SELECT id INTO v_type_peinture   FROM propria_intervention_types WHERE name = 'Peinture';

  -- ─── Biens : on crée 15 biens externes Propria ────────────────────────────
  INSERT INTO properties (id, name, type, status, quartier, address, latitude, longitude,
    superficie, floor, propria_internal_code, propria_managed_at,
    propria_owner_name, propria_owner_phone, propria_owner_email,
    propria_capacity_voyageurs, propria_nb_chambres, propria_type_lits,
    propria_commission_rate, propria_mandate_start, propria_mandate_end,
    propria_wifi_ssid, propria_wifi_password, propria_lock_code, propria_nb_keys,
    propria_arrival_video_url, propria_airbnb_url, propria_booking_url,
    propria_base_price_per_night, propria_observations, propria_default_provider_id
  ) VALUES
    (gen_random_uuid(), 'Riad Majorelle',  'Riad',        'a_verifier', 'Médina',     'Derb Sidi Bouloukate, Marrakech',   31.6295, -7.9811, 280, 'RDC', 'MAJORELLE', now(),
      'Mohammed El Idrissi', '+212 6 11 22 33 44', 'm.elidrissi@example.com',
      8, 4, '2 king + 2 queen + canapé-lit', 20, '2026-01-01', '2027-12-31',
      'RiadMajorelle_Guest', 'Welcome2026!', '4815', 4,
      'https://drive.google.com/file/d/demo-majorelle-arrival/view',
      'https://airbnb.com/rooms/demo-majorelle', 'https://booking.com/demo-majorelle',
      1800, '[PROPRIA-DEMO] Riad emblématique du portefeuille', v_prov_abdellatif),

    (gen_random_uuid(), 'Apt Atlas 1',     'Appartement', 'a_verifier', 'Gueliz',     '15 Rue Atlas, Marrakech',           31.6357, -8.0117, 95, '3', 'ATLAS-1', now(),
      'Fatima Benkirane', '+212 6 22 33 44 55', 'f.benkirane@example.com',
      4, 2, '1 king + 2 simples', 20, '2026-03-01', '2027-02-28',
      'AtlasWifi', 'Atlas2026!', '7421', 3,
      'https://drive.google.com/file/d/demo-atlas-arrival/view',
      'https://airbnb.com/rooms/demo-atlas', NULL,
      850, '[PROPRIA-DEMO] Bien standard Gueliz', v_prov_zakaria),

    (gen_random_uuid(), 'Villa Palmeraie', 'Villa',       'a_verifier', 'Palmeraie',  'Route de Fès, Palmeraie',           31.6700, -7.9500, 420, 'RDC', 'PALMERAIE', now(),
      'Mr & Mrs Cohen', '+33 6 88 77 66 55', 'cohen.family@example.com',
      10, 5, '4 king + canapé-lit', 18, '2026-02-01', '2027-12-31',
      'PalmeraieVilla', 'Palms2026!', '0011', 5,
      'https://drive.google.com/file/d/demo-palmeraie-arrival/view',
      'https://airbnb.com/rooms/demo-palmeraie', 'https://booking.com/demo-palmeraie',
      3500, '[PROPRIA-DEMO] Villa haut de gamme avec piscine', v_prov_abdellatif),

    (gen_random_uuid(), 'AF 1',            'Appartement', 'a_verifier', 'Hivernage',  '8 Rue Yougoslavie',                 31.6310, -8.0095, 75, '2', 'AF-1', now(),
      'Andre Fortin', '+33 6 11 22 33 44', 'andre.fortin@example.com',
      3, 2, '1 king + 1 simple', 20, '2025-09-01', '2026-12-31',
      'AF1Guest', 'AF12026!', '1234', 2,
      'https://drive.google.com/file/d/demo-af1-arrival/view',
      'https://airbnb.com/rooms/demo-af1', NULL, 650, '[PROPRIA-DEMO]', v_prov_said),

    (gen_random_uuid(), 'AF 2',            'Appartement', 'a_verifier', 'Hivernage',  '8 Rue Yougoslavie',                 31.6311, -8.0094, 70, '2', 'AF-2', now(),
      'Andre Fortin', '+33 6 11 22 33 44', 'andre.fortin@example.com',
      2, 1, '1 king', 20, '2025-09-01', '2026-12-31',
      'AF2Guest', 'AF22026!', '5678', 2,
      'https://drive.google.com/file/d/demo-af2-arrival/view',
      'https://airbnb.com/rooms/demo-af2', NULL, 550, '[PROPRIA-DEMO]', v_prov_said),

    (gen_random_uuid(), 'MAJO 1',          'Appartement', 'a_verifier', 'Médina',     'Derb El Mokhfia',                   31.6260, -7.9870, 60, '1', 'MAJO-1', now(),
      'Patricia Lambert', '+33 6 44 55 66 77', 'p.lambert@example.com',
      2, 1, '1 queen', 20, '2025-11-01', '2026-12-31',
      'Majo1', 'Majo2026!', '8888', 2,
      'https://drive.google.com/file/d/demo-majo1-arrival/view',
      'https://airbnb.com/rooms/demo-majo1', 'https://booking.com/demo-majo1',
      450, '[PROPRIA-DEMO]', v_prov_abdellatif),

    (gen_random_uuid(), 'MAJO 2',          'Appartement', 'a_verifier', 'Médina',     'Derb El Mokhfia',                   31.6261, -7.9869, 80, '2', 'MAJO-2', now(),
      'Patricia Lambert', '+33 6 44 55 66 77', 'p.lambert@example.com',
      4, 2, '1 king + 2 simples', 20, '2025-11-01', '2026-12-31',
      'Majo2', 'Majo2026!', '9999', 3,
      'https://drive.google.com/file/d/demo-majo2-arrival/view',
      'https://airbnb.com/rooms/demo-majo2', 'https://booking.com/demo-majo2',
      680, '[PROPRIA-DEMO]', v_prov_abdellatif),

    (gen_random_uuid(), 'MAJO 3',          'Appartement', 'a_verifier', 'Médina',     'Derb El Mokhfia',                   31.6262, -7.9868, 90, '3', 'MAJO-3', now(),
      'Patricia Lambert', '+33 6 44 55 66 77', 'p.lambert@example.com',
      5, 2, '1 king + 3 simples', 20, '2025-11-01', '2026-12-31',
      'Majo3', 'Majo2026!', '7777', 3,
      'https://drive.google.com/file/d/demo-majo3-arrival/view',
      'https://airbnb.com/rooms/demo-majo3', 'https://booking.com/demo-majo3',
      850, '[PROPRIA-DEMO]', v_prov_abdellatif),

    (gen_random_uuid(), 'WARDA 3',         'Appartement', 'a_verifier', 'Massira',    '12 Av. Mohammed VI',                31.6420, -8.0200, 85, '4', 'WARDA-3', now(),
      'Tarik Bensouda', '+212 6 55 66 77 88', 't.bensouda@example.com',
      4, 2, '1 king + 2 simples', 20, '2026-01-15', '2027-01-14',
      'Warda3', 'Warda2026!', '5555', 2,
      'https://drive.google.com/file/d/demo-warda3-arrival/view',
      'https://airbnb.com/rooms/demo-warda3', NULL, 720, '[PROPRIA-DEMO]', v_prov_yassin),

    (gen_random_uuid(), 'STEVEN 1',        'Riad',        'a_verifier', 'Médina',     'Riad Zitoun el Kedim',              31.6240, -7.9840, 180, 'RDC', 'STEVEN-1', now(),
      'Steven Martin', '+44 7700 900123', 'steven.martin@example.co.uk',
      6, 3, '1 king + 2 queen', 20, '2025-08-01', '2027-07-31',
      'StevenRiad', 'Riad2026!', '2727', 3,
      'https://drive.google.com/file/d/demo-steven1-arrival/view',
      'https://airbnb.com/rooms/demo-steven1', 'https://booking.com/demo-steven1',
      1200, '[PROPRIA-DEMO]', v_prov_abdellatif),

    (gen_random_uuid(), 'CATHERINE 1',     'Appartement', 'a_verifier', 'Hivernage',  '25 Rue Imam Malik',                 31.6320, -8.0080, 110, '5', 'CATH-1', now(),
      'Catherine Dupond', '+33 6 12 34 56 78', 'catherine.dupond@example.com',
      5, 3, '1 king + 2 queen', 20, '2026-04-01', '2027-03-31',
      'CathWifi', 'Cath2026!', '6543', 4,
      'https://drive.google.com/file/d/demo-cath1-arrival/view',
      'https://airbnb.com/rooms/demo-cath1', 'https://booking.com/demo-cath1',
      950, '[PROPRIA-DEMO]', v_prov_abdellatif),

    (gen_random_uuid(), 'PAUL 1',          'Appartement', 'a_verifier', 'Gueliz',     '8 Rue Tariq Ibn Ziad',              31.6360, -8.0120, 75, '3', 'PAUL-1', now(),
      'Paul Bernard', '+33 6 98 76 54 32', 'paul.bernard@example.com',
      3, 2, '1 king + 1 simple', 20, '2026-02-15', '2027-02-14',
      'Paul1Net', 'Paul2026!', '1010', 2,
      'https://drive.google.com/file/d/demo-paul1-arrival/view',
      'https://airbnb.com/rooms/demo-paul1', NULL, 620, '[PROPRIA-DEMO]', v_prov_yassin),

    (gen_random_uuid(), 'DUC 1',           'Appartement', 'a_verifier', 'Gueliz',     '14 Av. Hassan II',                  31.6370, -8.0140, 65, '2', 'DUC-1', now(),
      'Famille Duc', '+33 6 22 33 44 55', 'duc.famille@example.com',
      2, 1, '1 king', 20, '2026-01-01', '2026-12-31',
      'Duc1', 'Duc2026!', '3030', 2,
      'https://drive.google.com/file/d/demo-duc1-arrival/view',
      'https://airbnb.com/rooms/demo-duc1', 'https://booking.com/demo-duc1',
      580, '[PROPRIA-DEMO]', v_prov_zakaria),

    (gen_random_uuid(), 'HABIB 1',         'Appartement', 'a_verifier', 'Massira',    '40 Rue Targa',                      31.6450, -8.0220, 70, '1', 'HABIB-1', now(),
      'Habib Sellami', '+212 6 77 88 99 00', 'h.sellami@example.com',
      3, 2, '1 king + 1 simple', 20, '2025-12-01', '2026-11-30',
      'Habib1', 'Habib2026!', '1212', 2,
      'https://drive.google.com/file/d/demo-habib1-arrival/view',
      'https://airbnb.com/rooms/demo-habib1', NULL, 600, '[PROPRIA-DEMO]', v_prov_said),

    (gen_random_uuid(), 'JOUNDY 3',        'Appartement', 'a_verifier', 'Targa',      '78 Av. Allal El Fassi',             31.6500, -8.0250, 95, '3', 'JOUNDY-3', now(),
      'Hassan Joundy', '+212 6 88 99 00 11', 'h.joundy@example.com',
      4, 2, '1 king + 2 simples', 20, '2026-01-01', '2027-12-31',
      'Joundy3', 'Joundy2026!', '4242', 3,
      'https://drive.google.com/file/d/demo-joundy3-arrival/view',
      'https://airbnb.com/rooms/demo-joundy3', 'https://booking.com/demo-joundy3',
      780, '[PROPRIA-DEMO]', v_prov_abdellatif);

  -- récupère les IDs créés (par code interne unique grâce au tag DEMO)
  SELECT id INTO v_bien_majorelle  FROM properties WHERE propria_internal_code = 'MAJORELLE'  AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_atlas      FROM properties WHERE propria_internal_code = 'ATLAS-1'    AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_palmeraie  FROM properties WHERE propria_internal_code = 'PALMERAIE'  AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_af1        FROM properties WHERE propria_internal_code = 'AF-1'       AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_af2        FROM properties WHERE propria_internal_code = 'AF-2'       AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_majo1      FROM properties WHERE propria_internal_code = 'MAJO-1'     AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_majo2      FROM properties WHERE propria_internal_code = 'MAJO-2'     AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_majo3      FROM properties WHERE propria_internal_code = 'MAJO-3'     AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_warda3     FROM properties WHERE propria_internal_code = 'WARDA-3'    AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_steven1    FROM properties WHERE propria_internal_code = 'STEVEN-1'   AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_catherine1 FROM properties WHERE propria_internal_code = 'CATH-1'     AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_paul1      FROM properties WHERE propria_internal_code = 'PAUL-1'     AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_duc1       FROM properties WHERE propria_internal_code = 'DUC-1'      AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_habib1     FROM properties WHERE propria_internal_code = 'HABIB-1'    AND propria_observations LIKE '[PROPRIA-DEMO]%';
  SELECT id INTO v_bien_joundy3    FROM properties WHERE propria_internal_code = 'JOUNDY-3'   AND propria_observations LIKE '[PROPRIA-DEMO]%';

  -- ─── Caisses + dotations + dépenses ───────────────────────────────────────
  INSERT INTO propria_wallets (profile_id, label, opened_at, notes) VALUES
    (v_assist_id,  'Caisse terrain Marrakech', CURRENT_DATE - INTERVAL '60 days', '[PROPRIA-DEMO]'),
    (v_assist2_id, 'Caisse terrain Hivernage', CURRENT_DATE - INTERVAL '45 days', '[PROPRIA-DEMO]'),
    (v_chef_id,    'Caisse chef de projet',    CURRENT_DATE - INTERVAL '90 days', '[PROPRIA-DEMO]');

  SELECT id INTO v_wallet_assist1 FROM propria_wallets WHERE profile_id = v_assist_id  AND notes = '[PROPRIA-DEMO]';
  SELECT id INTO v_wallet_assist2 FROM propria_wallets WHERE profile_id = v_assist2_id AND notes = '[PROPRIA-DEMO]';
  SELECT id INTO v_wallet_chef    FROM propria_wallets WHERE profile_id = v_chef_id    AND notes = '[PROPRIA-DEMO]';

  -- Dotations (le CEO remet du cash)
  INSERT INTO propria_wallet_dotations (wallet_id, given_at, amount_mad, type, given_by, note) VALUES
    (v_wallet_assist1, CURRENT_DATE - 60, 5000, 'dotation',     v_ceo_id, 'Dotation initiale'),
    (v_wallet_assist1, CURRENT_DATE - 30, 3000, 'rechargement', v_ceo_id, 'Rechargement mi-mois'),
    (v_wallet_assist1, CURRENT_DATE - 10, 2000, 'rechargement', v_ceo_id, 'Rechargement'),
    (v_wallet_assist2, CURRENT_DATE - 45, 4000, 'dotation',     v_ceo_id, 'Dotation initiale'),
    (v_wallet_assist2, CURRENT_DATE - 15, 2500, 'rechargement', v_ceo_id, 'Rechargement'),
    (v_wallet_chef,    CURRENT_DATE - 90, 8000, 'dotation',     v_ceo_id, 'Dotation initiale chef'),
    (v_wallet_chef,    CURRENT_DATE - 30, 5000, 'rechargement', v_ceo_id, 'Rechargement mensuel');

  -- Dépenses variées
  INSERT INTO propria_wallet_expenses (wallet_id, spent_at, property_id, category, description, amount_mad, charge_to, is_validated, validated_at, validated_by, reimbursed_at, reimbursed_by, observations) VALUES
    (v_wallet_assist1, CURRENT_DATE - 55, v_bien_af1,       'Courses',     'Produits ménage + papier toilette', 380,  'propria', true,  now() - INTERVAL '50 days', v_finance_id, CURRENT_DATE - 40, v_finance_id, NULL),
    (v_wallet_assist1, CURRENT_DATE - 40, v_bien_majo1,     'Réparation',  'Achat ampoule + tube néon',          85,   'propria', true,  now() - INTERVAL '38 days', v_finance_id, CURRENT_DATE - 30, v_finance_id, NULL),
    (v_wallet_assist1, CURRENT_DATE - 25, v_bien_af2,       'Transport',   'Taxi urgence panne clim',            120,  'propria', true,  now() - INTERVAL '24 days', v_finance_id, NULL,              NULL,         NULL),
    (v_wallet_assist1, CURRENT_DATE - 12, v_bien_majo3,     'Cadeaux',     'Plateau bienvenue voyageur VIP',     250,  'propria', true,  now() - INTERVAL '10 days', v_finance_id, NULL,              NULL,         NULL),
    (v_wallet_assist1, CURRENT_DATE - 5,  NULL,             'Courses',     'Reprovisionner stock central',       640,  'propria', false, NULL, NULL, NULL, NULL, NULL),
    (v_wallet_assist2, CURRENT_DATE - 40, v_bien_atlas,     'Réparation',  'Clé cassée — duplication',           150,  'client',  true,  now() - INTERVAL '38 days', v_finance_id, CURRENT_DATE - 25, v_finance_id, NULL),
    (v_wallet_assist2, CURRENT_DATE - 20, v_bien_paul1,     'Ménage',      'Renfort weekend (turnover dense)',   300,  'propria', true,  now() - INTERVAL '19 days', v_finance_id, NULL,              NULL,         NULL),
    (v_wallet_assist2, CURRENT_DATE - 8,  v_bien_duc1,      'Mobilier',    'Achat coussins + plaid',             420,  'client',  false, NULL, NULL, NULL, NULL, NULL),
    (v_wallet_chef,    CURRENT_DATE - 80, v_bien_palmeraie, 'Réparation',  'Pompe piscine — pièce détachée',     1200, 'client',  true,  now() - INTERVAL '78 days', v_ceo_id,     CURRENT_DATE - 60, v_ceo_id,     'Refacturé client'),
    (v_wallet_chef,    CURRENT_DATE - 35, v_bien_steven1,   'Réparation',  'Chauffe-eau — main d''œuvre',        850,  'client',  true,  now() - INTERVAL '33 days', v_ceo_id,     CURRENT_DATE - 20, v_ceo_id,     'Refacturé client'),
    (v_wallet_chef,    CURRENT_DATE - 15, NULL,             'Bureau',      'Fournitures bureau Stoniz',          180,  'propria', true,  now() - INTERVAL '14 days', v_ceo_id,     NULL,              NULL,         NULL),
    (v_wallet_chef,    CURRENT_DATE - 3,  v_bien_catherine1,'Urgence',     'Plombier weekend — fuite WC',        450,  'client',  false, NULL, NULL, NULL, NULL, 'En attente validation');

  -- ─── Consommables (stock central) ──────────────────────────────────────────
  INSERT INTO propria_consumables (reference, name, category, unit, unit_price_mad, min_threshold, default_order_qty, supplier, initial_stock, notes) VALUES
    ('ENT-001', 'Liquide vaisselle 1L',       'Entretien',  'L',     16,    10,  20,  'ACHIBEST',     5,   '[PROPRIA-DEMO]'),
    ('ENT-002', 'Spray parfumé 400ML',         'Entretien',  'pièce', 13,    10,  20,  'Grossiste',    1,   '[PROPRIA-DEMO]'),
    ('ENT-003', 'Dégraissant LINAS',           'Entretien',  'pièce', 8,     10,  20,  'Grossiste',    0,   '[PROPRIA-DEMO]'),
    ('ENT-006', 'Éponges (lot)',               'Entretien',  'pièce', 1.80,  30,  60,  'ASWAK SALAM',  20,  '[PROPRIA-DEMO]'),
    ('ENT-007', 'Torchants microfibre',        'Entretien',  'pièce', 4,     20,  40,  'CARREFOUR',    8,   '[PROPRIA-DEMO]'),
    ('ENT-008', 'Sacs poubelle 35L',           'Entretien',  'rouleau',12,   10,  20,  'ACHIBEST',     57,  '[PROPRIA-DEMO]'),
    ('ENT-009', 'Sacs poubelle 60L',           'Entretien',  'rouleau',18,   10,  20,  'ACHIBEST',     61,  '[PROPRIA-DEMO]'),
    ('ENT-016', 'Eau de Javel 1L',             'Entretien',  'L',     5.22,  10,  20,  'ACHIBEST',     39,  '[PROPRIA-DEMO]'),
    ('ENT-018', 'Seau',                        'Entretien',  'pièce', 10,    4,   6,   'Grossiste',    4,   '[PROPRIA-DEMO]'),
    ('TOI-001', 'Shampooing 5L',               'Toiletries', 'L',     130,   5,   10,  'Equipement spa', 6, '[PROPRIA-DEMO]'),
    ('TOI-002', 'Gel douche 5L',               'Toiletries', 'L',     120,   5,   10,  'Equipement spa', 2, '[PROPRIA-DEMO]'),
    ('TOI-003', 'Savon liquide 5L',            'Toiletries', 'L',     56,    5,   40,  'ACHIBEST',     74,  '[PROPRIA-DEMO]'),
    ('TOI-004', 'Papier toilette (lot 6)',     'Toiletries', 'lot',   21.50, 20,  20,  'ACHIBEST',     4,   '[PROPRIA-DEMO]'),
    ('LIN-001', 'Draps king 240×280 blanc',    'Linge',      'pièce', 220,   8,   16,  'MarocLinge',   12,  '[PROPRIA-DEMO]'),
    ('LIN-002', 'Taie d''oreiller blanc',      'Linge',      'pièce', 35,    20,  40,  'MarocLinge',   28,  '[PROPRIA-DEMO]'),
    ('LIN-003', 'Serviette de bain blanche',   'Linge',      'pièce', 65,    15,  30,  'MarocLinge',   22,  '[PROPRIA-DEMO]'),
    ('CUI-001', 'Capsules Nespresso (boîte)',  'Cuisine',    'boîte', 85,    5,   10,  'Carrefour',    3,   '[PROPRIA-DEMO]'),
    ('CUI-002', 'Thé à la menthe (sachet)',    'Cuisine',    'sachet',12,    10,  20,  'Souk',         18,  '[PROPRIA-DEMO]');

  SELECT id INTO v_consum_liq_vais FROM propria_consumables WHERE reference = 'ENT-001';
  SELECT id INTO v_consum_sacs     FROM propria_consumables WHERE reference = 'ENT-008';
  SELECT id INTO v_consum_papier   FROM propria_consumables WHERE reference = 'TOI-004';
  SELECT id INTO v_consum_shampoo  FROM propria_consumables WHERE reference = 'TOI-001';

  -- Mouvements de stock
  INSERT INTO propria_stock_movements (consumable_id, movement_type, movement_date, quantity, unit_price_mad, source_destination, property_id, responsible_id, notes) VALUES
    (v_consum_liq_vais, 'entree', CURRENT_DATE - 30, 30, 16,    'ACHIBEST commande mensuelle', NULL,           v_assist_id, '[PROPRIA-DEMO]'),
    (v_consum_liq_vais, 'sortie', CURRENT_DATE - 20, 4,  NULL,  'Affecté à Riad Majorelle',     v_bien_majorelle, v_assist_id, '[PROPRIA-DEMO]'),
    (v_consum_liq_vais, 'sortie', CURRENT_DATE - 15, 3,  NULL,  'Affecté à MAJO 2',             v_bien_majo2,    v_assist_id, '[PROPRIA-DEMO]'),
    (v_consum_liq_vais, 'sortie', CURRENT_DATE - 10, 6,  NULL,  'Affecté à Villa Palmeraie',    v_bien_palmeraie,v_assist_id, '[PROPRIA-DEMO]'),
    (v_consum_liq_vais, 'sortie', CURRENT_DATE - 5,  5,  NULL,  'Affecté à AF 1 + AF 2',        v_bien_af1,      v_assist2_id,'[PROPRIA-DEMO]'),
    (v_consum_sacs,     'entree', CURRENT_DATE - 25, 50, 12,    'ACHIBEST',                     NULL,           v_assist_id, '[PROPRIA-DEMO]'),
    (v_consum_sacs,     'sortie', CURRENT_DATE - 18, 18, NULL,  'Tournée propreté ménage',      NULL,           v_assist2_id,'[PROPRIA-DEMO]'),
    (v_consum_papier,   'entree', CURRENT_DATE - 28, 40, 21.50, 'ACHIBEST',                     NULL,           v_assist_id, '[PROPRIA-DEMO]'),
    (v_consum_papier,   'sortie', CURRENT_DATE - 12, 36, NULL,  'Distribution sur tous biens',   NULL,           v_assist2_id,'[PROPRIA-DEMO]'),
    (v_consum_shampoo,  'entree', CURRENT_DATE - 22, 6,  130,   'Équipement spa — réappro',     NULL,           v_chef_id,   '[PROPRIA-DEMO]'),
    (v_consum_shampoo,  'sortie', CURRENT_DATE - 10, 6,  NULL,  'Remplissage stations spa',     v_bien_palmeraie,v_assist_id, '[PROPRIA-DEMO]');

  -- ─── Interventions ────────────────────────────────────────────────────────
  -- Mix : critiques en cours, hautes à traiter, normales clôturées, basses clôturées
  INSERT INTO propria_interventions
    (property_id, intervention_type_id, description, occurred_at, urgency, status,
     closed_at, responsable_id, provider_id, cost_propria_mad, client_billing_mad, charge_to, observations, created_by)
  VALUES
    -- Critiques en cours
    (v_bien_catherine1, v_type_plomb, 'Fuite WC chambre principale - eau au sol',         CURRENT_DATE - 1,  'critique', 'en_cours',  NULL, v_assist_id,  v_prov_mehdi,      NULL, NULL, 'client',   '[PROPRIA-DEMO] Intervention urgente en cours', v_ceo_id),
    (v_bien_palmeraie,  v_type_clim,  'Climatisation HS dans la chambre 3 - voyageurs arrivent demain', CURRENT_DATE,    'critique', 'a_traiter', NULL, v_chef_id,    v_prov_zakaria,    NULL, NULL, 'propria', '[PROPRIA-DEMO] À résoudre AVANT check-in 16h', v_ceo_id),
    (v_bien_steven1,    v_type_elec,  'Disjoncteur saute en continu - sécurité',          CURRENT_DATE - 2,  'critique', 'en_cours',  NULL, v_assist_id,  v_prov_yassin,     NULL, NULL, 'client',   '[PROPRIA-DEMO]', v_ceo_id),

    -- Hautes à traiter
    (v_bien_atlas,      v_type_wifi,  'Wifi très lent - voyageurs se plaignent',         CURRENT_DATE - 3,  'haute',    'a_traiter', NULL, v_assist2_id, v_prov_yassin,     NULL, NULL, 'propria',  '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_warda3,     v_type_serrurerie, 'Serrure porte d''entrée dure à fermer',     CURRENT_DATE - 4,  'haute',    'en_cours',  NULL, v_assist_id,  v_prov_ali,        NULL, NULL, 'client',   '[PROPRIA-DEMO]', v_chef_id),

    -- Normales clôturées (avec coût + facturation)
    (v_bien_af1,        v_type_plomb,    'Joint robinet salle de bain - fuite légère',  CURRENT_DATE - 15, 'normale',  'cloture',   now() - INTERVAL '12 days', v_assist2_id, v_prov_mehdi,      250, 400, 'client',   '[PROPRIA-DEMO] OK', v_chef_id),
    (v_bien_af1,        v_type_menage,   'Ménage renforcé après long séjour',           CURRENT_DATE - 20, 'normale',  'cloture',   now() - INTERVAL '19 days', v_assist2_id, v_prov_said,       240, 300, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_af2,        v_type_clim,     'Maintenance climatisation annuelle',          CURRENT_DATE - 30, 'normale',  'cloture',   now() - INTERVAL '28 days', v_assist2_id, v_prov_zakaria,    150, 250, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_majo1,      v_type_plomb,    'Évier cuisine bouché',                        CURRENT_DATE - 18, 'normale',  'cloture',   now() - INTERVAL '17 days', v_assist_id,  v_prov_mehdi,      200, 350, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_majo1,      v_type_elec,     'Remplacement ampoules salon + chambre',       CURRENT_DATE - 25, 'normale',  'cloture',   now() - INTERVAL '24 days', v_assist_id,  v_prov_yassin,     85,  130, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_majo2,      v_type_clim,     'Filtre clim encrassé - nettoyage',            CURRENT_DATE - 22, 'normale',  'cloture',   now() - INTERVAL '21 days', v_assist_id,  v_prov_zakaria,    180, 280, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_majo2,      v_type_menuiserie, 'Porte armoire - charnière à fixer',         CURRENT_DATE - 28, 'normale',  'cloture',   now() - INTERVAL '27 days', v_assist_id,  v_prov_abdellatif, 120, 200, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_majo2,      v_type_menage,   'Nettoyage moquette suite tache vin',          CURRENT_DATE - 8,  'normale',  'cloture',   now() - INTERVAL '7 days',  v_assist_id,  v_prov_said,       180, 250, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_majo2,      v_type_wifi,     'Reboot box internet',                         CURRENT_DATE - 35, 'normale',  'cloture',   now() - INTERVAL '34 days', v_assist_id,  NULL,              NULL,NULL,'propria',  '[PROPRIA-DEMO] Réglé sur place', v_chef_id),
    (v_bien_majo3,      v_type_peinture, 'Retouches peinture salon',                    CURRENT_DATE - 40, 'normale',  'cloture',   now() - INTERVAL '38 days', v_chef_id,    v_prov_jawad,      500, 700, 'client',   '[PROPRIA-DEMO]', v_ceo_id),
    (v_bien_majo3,      v_type_menuiserie, 'Installation étagère murale',               CURRENT_DATE - 32, 'normale',  'cloture',   now() - INTERVAL '30 days', v_chef_id,    v_prov_abdellatif, 380, 500, 'client',   '[PROPRIA-DEMO]', v_ceo_id),
    (v_bien_paul1,      v_type_elec,     'Prise USB de la cuisine HS',                  CURRENT_DATE - 14, 'normale',  'cloture',   now() - INTERVAL '12 days', v_assist2_id, v_prov_yassin,     90,  150, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_paul1,      v_type_clim,     'Télécommande clim - piles + bouton',          CURRENT_DATE - 9,  'basse',    'cloture',   now() - INTERVAL '8 days',  v_assist2_id, NULL,              NULL,NULL,'propria',  '[PROPRIA-DEMO] Réglé par assistant', v_chef_id),
    (v_bien_duc1,       v_type_plomb,    'Chasse d''eau qui fuit doucement',            CURRENT_DATE - 6,  'haute',    'cloture',   now() - INTERVAL '5 days',  v_assist2_id, v_prov_mehdi,      150, 250, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_habib1,     v_type_serrurerie, 'Boîte à clés bloquée',                      CURRENT_DATE - 12, 'haute',    'cloture',   now() - INTERVAL '11 days', v_assist_id,  v_prov_ali,        100, 200, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_joundy3,    v_type_clim,     'Maintenance préventive clim',                 CURRENT_DATE - 45, 'normale',  'cloture',   now() - INTERVAL '44 days', v_assist_id,  v_prov_zakaria,    200, 300, 'client',   '[PROPRIA-DEMO]', v_chef_id),
    (v_bien_joundy3,    v_type_peinture, 'Petites retouches murs salon',                CURRENT_DATE - 60, 'basse',    'cloture',   now() - INTERVAL '58 days', v_chef_id,    v_prov_jawad,      300, 450, 'client',   '[PROPRIA-DEMO]', v_ceo_id),

    -- Une annulée
    (v_bien_atlas,      v_type_plomb,    'Demande fausse alerte voyageur',              CURRENT_DATE - 5,  'basse',    'annule',    now() - INTERVAL '4 days',  v_assist2_id, NULL,              NULL,NULL,'a_definir','[PROPRIA-DEMO] Faux signalement', v_chef_id);

  -- ─── Maintenance préventive : génère pour ce trimestre ────────────────────
  PERFORM propria_generate_maintenance_visits(CURRENT_DATE);
  -- Génère aussi pour le trimestre précédent (pour avoir de l'historique)
  PERFORM propria_generate_maintenance_visits((CURRENT_DATE - INTERVAL '3 months')::date);

  -- Marque quelques visites du trimestre précédent comme réalisées
  UPDATE propria_maintenance_visits
    SET status = 'realise',
        scheduled_at = due_date - INTERVAL '20 days',
        completed_at = (due_date - INTERVAL '15 days')::timestamptz,
        responsable_id = v_assist_id,
        notes = 'Visite réalisée sans incident majeur. Quelques points relevés mais traités sur place.',
        checklist = '[
          {"key":"plomberie","title":"Plomberie","icon":"🚿","items":[
            {"key":"robinets","label":"Robinets : pas de fuites, débit OK","done":true},
            {"key":"wc","label":"WC : chasse, joints","done":true},
            {"key":"chauffe_eau","label":"Chauffe-eau : eau chaude OK","done":true},
            {"key":"evacuations","label":"Évacuations : pas dodeurs, écoulement OK","done":true},
            {"key":"siphons","label":"Siphons nettoyés","done":true}
          ]},
          {"key":"electricite","title":"Électricité","icon":"⚡","items":[
            {"key":"prises","label":"Toutes les prises fonctionnent","done":true},
            {"key":"ampoules","label":"Ampoules : aucune grillée","done":true,"observation":"2 ampoules remplacées"},
            {"key":"interrupteurs","label":"Interrupteurs en bon état","done":true},
            {"key":"disjoncteur","label":"Disjoncteur testé","done":true},
            {"key":"appareils","label":"Appareils électroménagers OK","done":true}
          ]}
        ]'::jsonb
    WHERE property_id IN (v_bien_majorelle, v_bien_atlas, v_bien_af1, v_bien_majo2, v_bien_paul1, v_bien_steven1)
      AND quarter = quarter_label((CURRENT_DATE - INTERVAL '3 months')::date);

  -- Marque quelques visites du trimestre courant comme planifiées (avec checklist amorcée)
  UPDATE propria_maintenance_visits
    SET status = 'planifie',
        scheduled_at = due_date - INTERVAL '5 days',
        responsable_id = v_assist_id,
        checklist = '[
          {"key":"plomberie","title":"Plomberie","icon":"🚿","items":[
            {"key":"robinets","label":"Robinets","done":true},
            {"key":"wc","label":"WC","done":false},
            {"key":"chauffe_eau","label":"Chauffe-eau","done":false}
          ]}
        ]'::jsonb
    WHERE property_id IN (v_bien_majo1, v_bien_warda3, v_bien_catherine1)
      AND quarter = quarter_label(CURRENT_DATE);

  -- ─── Réservations en espèces ──────────────────────────────────────────────
  INSERT INTO propria_cash_reservations
    (property_id, voyageur_name, arrival_date, departure_date, nb_nights, amount_mad,
     assistant_id, recovered_at, recovered, remitted_to_ceo, remitted_at, remitted_confirmed_by, observations)
  VALUES
    -- Confirmées remises
    (v_bien_catherine1, 'Lucas Schmidt',     CURRENT_DATE - 28, CURRENT_DATE - 26, 2, 1300, v_assist_id,  CURRENT_DATE - 26, true, true,  CURRENT_DATE - 25, v_ceo_id, '[PROPRIA-DEMO] Confirmé'),
    (v_bien_habib1,     'Anna Mueller',      CURRENT_DATE - 25, CURRENT_DATE - 23, 2, 3200, v_assist_id,  CURRENT_DATE - 23, true, true,  CURRENT_DATE - 22, v_ceo_id, '[PROPRIA-DEMO]'),
    (v_bien_majo2,      'Carlos Rivera',     CURRENT_DATE - 20, CURRENT_DATE - 17, 3, 2400, v_assist2_id, CURRENT_DATE - 17, true, true,  CURRENT_DATE - 15, v_ceo_id, '[PROPRIA-DEMO]'),
    -- Récupérées pas encore remises au CEO
    (v_bien_af1,        'Marie Lefevre',     CURRENT_DATE - 5,  CURRENT_DATE - 3,  2, 1300, v_assist2_id, CURRENT_DATE - 3,  true, false, NULL,              NULL,     '[PROPRIA-DEMO] En attente remise'),
    (v_bien_paul1,      'Tomas Andersson',   CURRENT_DATE - 3,  CURRENT_DATE - 1,  2, 1240, v_assist2_id, CURRENT_DATE - 1,  true, false, NULL,              NULL,     '[PROPRIA-DEMO]'),
    -- À récupérer (départ proche)
    (v_bien_atlas,      'Sophie Dubois',     CURRENT_DATE,      CURRENT_DATE + 2,  2, 1700, v_assist2_id, NULL,              false,false, NULL,              NULL,     '[PROPRIA-DEMO] Voyageur arrive aujourdhui'),
    (v_bien_warda3,     'Pierre Martin',     CURRENT_DATE + 1,  CURRENT_DATE + 4,  3, 2160, v_assist_id,  NULL,              false,false, NULL,              NULL,     '[PROPRIA-DEMO]'),
    (v_bien_joundy3,    'Yuki Tanaka',       CURRENT_DATE + 3,  CURRENT_DATE + 6,  3, 2340, v_assist_id,  NULL,              false,false, NULL,              NULL,     '[PROPRIA-DEMO]');

  -- ─── Transferts ───────────────────────────────────────────────────────────
  INSERT INTO propria_transfers (property_id, travel_date, voyageur_name, amount_mad, status, bon_signe, cash_collected, cash_remitted_at, driver_name, comment) VALUES
    (v_bien_majorelle,  CURRENT_DATE - 10, 'Lana Semba',         200, 'fait',     true,  true,  CURRENT_DATE - 9, 'Mehdi',  '[PROPRIA-DEMO] OK'),
    (v_bien_atlas,      CURRENT_DATE - 8,  'Timo Do',            200, 'fait',     true,  true,  CURRENT_DATE - 7, 'Mehdi',  '[PROPRIA-DEMO] OK'),
    (v_bien_majo2,      CURRENT_DATE - 6,  'Kameliya Doduncheva',200, 'fait',     true,  true,  CURRENT_DATE - 5, 'Mehdi',  '[PROPRIA-DEMO]'),
    (v_bien_warda3,     CURRENT_DATE - 5,  'Aalia Hussain',      200, 'fait',     true,  true,  CURRENT_DATE - 4, 'Mehdi',  '[PROPRIA-DEMO]'),
    (v_bien_palmeraie,  CURRENT_DATE - 4,  'Lea Gallo',          400, 'fait',     true,  true,  CURRENT_DATE - 3, 'Hassan', '[PROPRIA-DEMO] Trajet aéroport + retour'),
    (v_bien_af1,        CURRENT_DATE - 3,  'Samba M''bodj',      200, 'offert',   true,  false, NULL,             'Mehdi',  '[PROPRIA-DEMO] Geste commercial'),
    (v_bien_steven1,    CURRENT_DATE - 2,  'Inconnu',            200, 'anomalie', false, false, NULL,             'Mehdi',  '[PROPRIA-DEMO] Bon non signé - à vérifier'),
    (v_bien_catherine1, CURRENT_DATE,      'Sophie Dubois',      250, 'a_faire',  false, false, NULL,             'Mehdi',  '[PROPRIA-DEMO] Prévu ce soir 22h'),
    (v_bien_paul1,      CURRENT_DATE + 1,  'Pierre Martin',      200, 'a_faire',  false, false, NULL,             'Hassan', '[PROPRIA-DEMO]'),
    (v_bien_joundy3,    CURRENT_DATE + 3,  'Yuki Tanaka',        250, 'a_faire',  false, false, NULL,             'Mehdi',  '[PROPRIA-DEMO]');

  -- ─── Inventaires ──────────────────────────────────────────────────────────
  -- Inventaire général terminé sur Majorelle
  WITH new_inv AS (
    INSERT INTO propria_inventories (property_id, inventory_date, performed_by, type, notes, status)
    VALUES (v_bien_majorelle, CURRENT_DATE - 14, v_assist_id, 'general', '[PROPRIA-DEMO] Inventaire complet semestriel', 'termine')
    RETURNING id
  )
  INSERT INTO propria_inventory_items (inventory_id, category, name, quantity_expected, quantity_found, condition, observations) VALUES
    ((SELECT id FROM new_inv), 'Chambre 1', 'Lit king + matelas',          1, 1, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Chambre 1', 'Couette king',                1, 1, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Chambre 1', 'Oreillers',                   4, 4, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Chambre 1', 'Lampe de chevet',             2, 2, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Chambre 1', 'Table de chevet',             2, 2, 'usage',     'Petite rayure sur celle de droite'),
    ((SELECT id FROM new_inv), 'Cuisine',   'Cafetière Nespresso',         1, 1, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Cuisine',   'Verres à thé',                12,10,'usage',     '2 manquants - à recompter'),
    ((SELECT id FROM new_inv), 'Cuisine',   'Assiettes plates',            8, 8, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Salon',     'Canapé 3 places',             1, 1, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'Salon',     'TV Samsung 55"',              1, 1, 'neuf',      'Achetée le mois dernier'),
    ((SELECT id FROM new_inv), 'Salon',     'Tapis berbère salon',         1, 1, 'bon',       NULL),
    ((SELECT id FROM new_inv), 'SDB',       'Pèse-personne',               1, 1, 'usage',     NULL),
    ((SELECT id FROM new_inv), 'SDB',       'Sèche-cheveux',               1, 0, 'manquant',  'À remplacer - notifié hôte');

  -- Inventaire entrée séjour en cours sur AF1
  WITH new_inv AS (
    INSERT INTO propria_inventories (property_id, inventory_date, performed_by, type, notes, status)
    VALUES (v_bien_af1, CURRENT_DATE - 2, v_assist2_id, 'entree', '[PROPRIA-DEMO] Check-in voyageur Lefevre', 'en_cours')
    RETURNING id
  )
  INSERT INTO propria_inventory_items (inventory_id, category, name, quantity_expected, quantity_found, condition) VALUES
    ((SELECT id FROM new_inv), 'Chambre', 'Lit + literie',     1, 1, 'bon'),
    ((SELECT id FROM new_inv), 'Cuisine', 'Vaisselle complète',1, 1, 'bon'),
    ((SELECT id FROM new_inv), 'Salon',   'TV + télécommande', 1, 1, 'bon');

  -- ─── Notes annonces (Airbnb + Booking) — historique 4 mois ────────────────
  INSERT INTO propria_listing_metrics (property_id, platform, measured_at, rating, nb_reviews, occupancy_rate, notes) VALUES
    -- Majorelle
    (v_bien_majorelle,  'airbnb',  CURRENT_DATE - 90, 4.78, 124, 82, '[PROPRIA-DEMO]'),
    (v_bien_majorelle,  'airbnb',  CURRENT_DATE - 60, 4.82, 138, 85, '[PROPRIA-DEMO]'),
    (v_bien_majorelle,  'airbnb',  CURRENT_DATE - 30, 4.85, 152, 88, '[PROPRIA-DEMO]'),
    (v_bien_majorelle,  'airbnb',  CURRENT_DATE,      4.87, 165, 90, '[PROPRIA-DEMO]'),
    (v_bien_majorelle,  'booking', CURRENT_DATE - 30, 9.2,  78,  84, '[PROPRIA-DEMO]'),
    (v_bien_majorelle,  'booking', CURRENT_DATE,      9.3,  85,  87, '[PROPRIA-DEMO]'),
    -- Atlas 1
    (v_bien_atlas,      'airbnb',  CURRENT_DATE - 60, 4.65, 42,  70, '[PROPRIA-DEMO]'),
    (v_bien_atlas,      'airbnb',  CURRENT_DATE - 30, 4.70, 48,  74, '[PROPRIA-DEMO]'),
    (v_bien_atlas,      'airbnb',  CURRENT_DATE,      4.72, 55,  78, '[PROPRIA-DEMO]'),
    -- Palmeraie
    (v_bien_palmeraie,  'airbnb',  CURRENT_DATE - 60, 4.91, 56,  68, '[PROPRIA-DEMO]'),
    (v_bien_palmeraie,  'airbnb',  CURRENT_DATE - 30, 4.92, 62,  72, '[PROPRIA-DEMO]'),
    (v_bien_palmeraie,  'airbnb',  CURRENT_DATE,      4.93, 68,  75, '[PROPRIA-DEMO]'),
    (v_bien_palmeraie,  'booking', CURRENT_DATE,      9.5,  31,  73, '[PROPRIA-DEMO]'),
    -- AF 1
    (v_bien_af1,        'airbnb',  CURRENT_DATE - 30, 4.55, 28,  62, '[PROPRIA-DEMO]'),
    (v_bien_af1,        'airbnb',  CURRENT_DATE,      4.60, 33,  66, '[PROPRIA-DEMO]'),
    -- MAJO 2
    (v_bien_majo2,      'airbnb',  CURRENT_DATE - 60, 4.74, 71,  78, '[PROPRIA-DEMO]'),
    (v_bien_majo2,      'airbnb',  CURRENT_DATE - 30, 4.76, 78,  80, '[PROPRIA-DEMO]'),
    (v_bien_majo2,      'airbnb',  CURRENT_DATE,      4.78, 85,  83, '[PROPRIA-DEMO]'),
    (v_bien_majo2,      'booking', CURRENT_DATE,      9.0,  42,  79, '[PROPRIA-DEMO]'),
    -- Steven 1
    (v_bien_steven1,    'airbnb',  CURRENT_DATE - 30, 4.88, 92,  87, '[PROPRIA-DEMO]'),
    (v_bien_steven1,    'airbnb',  CURRENT_DATE,      4.89, 98,  89, '[PROPRIA-DEMO]'),
    (v_bien_steven1,    'booking', CURRENT_DATE,      9.4,  55,  85, '[PROPRIA-DEMO]'),
    -- Catherine 1
    (v_bien_catherine1, 'airbnb',  CURRENT_DATE - 30, 4.70, 18,  65, '[PROPRIA-DEMO]'),
    (v_bien_catherine1, 'airbnb',  CURRENT_DATE,      4.72, 22,  68, '[PROPRIA-DEMO]'),
    -- Paul 1
    (v_bien_paul1,      'airbnb',  CURRENT_DATE,      4.66, 19,  62, '[PROPRIA-DEMO]'),
    -- Duc 1
    (v_bien_duc1,       'airbnb',  CURRENT_DATE,      4.58, 14,  58, '[PROPRIA-DEMO]'),
    (v_bien_duc1,       'booking', CURRENT_DATE,      8.8,  9,   55, '[PROPRIA-DEMO]'),
    -- Habib 1
    (v_bien_habib1,     'airbnb',  CURRENT_DATE,      4.62, 11,  60, '[PROPRIA-DEMO]'),
    -- Joundy 3
    (v_bien_joundy3,    'airbnb',  CURRENT_DATE,      4.71, 24,  70, '[PROPRIA-DEMO]'),
    (v_bien_joundy3,    'booking', CURRENT_DATE,      9.1,  12,  68, '[PROPRIA-DEMO]');

  RAISE NOTICE '✓ Propria demo seed terminé : 15 biens, 7 prestataires, 3 caisses, 18 consommables, ~25 interventions, 8 réservations cash, 10 transferts, 2 inventaires, ~28 notes annonces.';
END $$;