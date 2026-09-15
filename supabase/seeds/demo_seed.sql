-- ============================================================================
-- DEMO SEED — 10 clients, 10 biens, 10 projets en phase travaux + lots
--
-- Pour charger ce seed :
--   psql "$DATABASE_URL" -f supabase/seeds/demo_seed.sql
-- OU dans le SQL editor de Supabase Dashboard : copier-coller l'intégralité.
--
-- ⚠ Ce seed insère des données factices. Pour repartir de zéro :
--   DELETE FROM travaux_encaissements WHERE notes ILIKE '[DEMO]%';
--   DELETE FROM travaux_payments      WHERE notes ILIKE '[DEMO]%';
--   DELETE FROM travaux_lots          WHERE description ILIKE '[DEMO]%';
--   DELETE FROM payments              WHERE notes ILIKE '[DEMO]%' OR project_id IN (
--     SELECT id FROM projects WHERE reference LIKE 'STZ-%' AND
--       client_id IN (SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co'));
--   DELETE FROM project_phases_history WHERE project_id IN (
--     SELECT id FROM projects WHERE client_id IN (SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co'));
--   DELETE FROM projects WHERE client_id IN (SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co');
--   DELETE FROM properties WHERE drive_url = 'demo-seed';
--   DELETE FROM clients WHERE email LIKE '%@demo.stoniz.co';
-- ============================================================================

DO $$
DECLARE
  client_ids   UUID[] := ARRAY[]::UUID[];
  property_ids UUID[] := ARRAY[]::UUID[];
  project_ids  UUID[] := ARRAY[]::UUID[];
  v_client     UUID;
  v_property   UUID;
  v_project    UUID;
  i            INTEGER;

  -- ─── 10 clients fictifs ──────────────────────────────────────────────
  cli_first_names  TEXT[] := ARRAY['Mehdi','Sophie','Marc','Yasmine','Pierre','Julie','Karim','Élodie','Thomas','Camille'];
  cli_last_names   TEXT[] := ARRAY['Bennani','Laurent','Dubois','El Fassi','Lambert','Moreau','Tazi','Petit','Müller','Rousseau'];
  cli_emails       TEXT[] := ARRAY[
    'mehdi.bennani@demo.stoniz.co','sophie.laurent@demo.stoniz.co','marc.dubois@demo.stoniz.co',
    'yasmine.elfassi@demo.stoniz.co','pierre.lambert@demo.stoniz.co','julie.moreau@demo.stoniz.co',
    'karim.tazi@demo.stoniz.co','elodie.petit@demo.stoniz.co','thomas.muller@demo.stoniz.co',
    'camille.rousseau@demo.stoniz.co'
  ];
  cli_phones       TEXT[] := ARRAY[
    '+212 6 61 12 34 56','+33 6 12 34 56 01','+33 6 12 34 56 02','+212 6 61 22 33 44',
    '+32 4 70 11 22 33','+33 6 12 34 56 03','+212 6 61 55 66 77','+33 6 12 34 56 04',
    '+41 79 123 45 67','+33 6 12 34 56 05'
  ];
  cli_nationalities TEXT[] := ARRAY['Marocaine','Française','Française','Marocaine','Belge','Française','Marocaine','Française','Suisse','Française'];
  cli_savings      NUMERIC[] := ARRAY[150000,80000,120000,95000,200000,60000,180000,75000,250000,90000];
  cli_budget_max   NUMERIC[] := ARRAY[280000,180000,220000,200000,350000,150000,320000,170000,420000,190000];

  -- ─── 10 biens fictifs (tous à Marrakech, status=vendu) ───────────────
  prop_names       TEXT[] := ARRAY[
    'Riad Majorelle 86m²','Apt Hivernage 120m²','Loft Gueliz 95m²','Penthouse Victor Hugo 145m²',
    'Apt Semlalia Familial 130m²','Apt Route de Casa Vue Atlas','Apt Gueliz Cosy 75m²',
    'Apt Hivernage Standing','Apt Majorelle Récent 110m²','Apt Victor Hugo Élégance 88m²'
  ];
  prop_quartiers   TEXT[] := ARRAY['Majorelle','Hivernage','Gueliz','Victor Hugo','Semlalia','Route de Casablanca','Gueliz','Hivernage','Majorelle','Victor Hugo'];
  prop_types       TEXT[] := ARRAY['Riad','Appartement','Appartement','Appartement','Appartement','Appartement','Appartement','Appartement','Appartement','Appartement'];
  prop_addresses   TEXT[] := ARRAY[
    'Rue Yves Saint Laurent, Majorelle','Avenue Mohammed VI, Hivernage','Rue Tarek Ibn Ziad, Gueliz',
    'Rue Victor Hugo, Gueliz','Rue de Semlalia, Semlalia','Route de Casablanca KM 5, Marrakech',
    'Rue Loubnane, Gueliz','Avenue de la Menara, Hivernage','Boulevard Allal El Fassi, Majorelle',
    'Rue Hugo, Victor Hugo'
  ];
  prop_superficies NUMERIC[] := ARRAY[86,120,95,145,130,140,75,95,110,88];
  prop_terrasses   NUMERIC[] := ARRAY[20,35,18,45,25,30,12,22,40,15];
  prop_floors      TEXT[]    := ARRAY['RDC','3e','2e','5e','1er','4e','2e','3e','4e','2e'];
  prop_suites      INTEGER[] := ARRAY[3,3,2,4,4,3,2,3,3,2];
  prop_prices      NUMERIC[] := ARRAY[180000,145000,135000,235000,170000,160000,98000,142000,158000,128000];
  prop_rents       NUMERIC[] := ARRAY[1900,1800,1500,2500,2000,1700,1100,1750,1850,1450];
  prop_agency      NUMERIC[] := ARRAY[14400,11600,10800,18800,13600,12800,7840,11360,12640,10240];
  prop_notary      NUMERIC[] := ARRAY[12600,10150,9450,16450,11900,11200,6860,9940,11060,8960];
  prop_travaux     NUMERIC[] := ARRAY[55000,42000,38000,68000,50000,45000,28000,40000,46000,36000];
  prop_badges      TEXT[]    := ARRAY['Riad de caractère','Division en 2','Loft moderne','Penthouse vue ville','Division possible','Vue Atlas','Idéal courte durée','Standing','Récent','Élégance classique'];

  -- ─── Profil chef de projet (premier dispo) ──────────────────────────
  v_chef UUID;

BEGIN
  -- Chef de projet par défaut (NULL si aucun profil staff disponible)
  SELECT id INTO v_chef FROM profiles
    WHERE role = 'chef_projet' AND is_active = true
    ORDER BY created_at LIMIT 1;

  -- ─── 1. CLIENTS ────────────────────────────────────────────────────
  FOR i IN 1..10 LOOP
    INSERT INTO clients (
      full_name, first_name, last_name, email, phone, nationality,
      budget_min, budget_max, available_savings, credit_type,
      location_preferences, property_type_preferences,
      consent_at, consent_version, onboarding_completed_at,
      -- onboarding v2
      investment_holding, investment_party_count,
      billing_address_line, billing_city, billing_postal_code, billing_country,
      expected_rent, expected_gross_yield_pct, expected_net_yield_pct
    ) VALUES (
      cli_first_names[i] || ' ' || cli_last_names[i],
      cli_first_names[i], cli_last_names[i], cli_emails[i], cli_phones[i], cli_nationalities[i],
      cli_savings[i] * 0.6, cli_budget_max[i], cli_savings[i],
      CASE WHEN i % 3 = 0 THEN 'yes' WHEN i % 5 = 0 THEN 'islamic' ELSE 'no' END,
      ARRAY['gueliz','hivernage','majorelle'], ARRAY['Appartement'],
      now() - INTERVAL '180 days', 'v2-onboarding', now() - INTERVAL '180 days',
      CASE WHEN i IN (2,5,9) THEN 'societe' ELSE 'nom_propre' END,
      CASE WHEN i IN (3,7) THEN 2 ELSE 1 END,
      (10 + i) || ' rue de la République',
      CASE i WHEN 1 THEN 'Casablanca' WHEN 2 THEN 'Lyon' WHEN 3 THEN 'Paris'
             WHEN 4 THEN 'Rabat' WHEN 5 THEN 'Bruxelles' WHEN 6 THEN 'Lyon'
             WHEN 7 THEN 'Marrakech' WHEN 8 THEN 'Bordeaux' WHEN 9 THEN 'Genève'
             ELSE 'Nice' END,
      CASE i WHEN 1 THEN '20000' WHEN 2 THEN '69000' WHEN 3 THEN '75001'
             WHEN 4 THEN '10000' WHEN 5 THEN '1000' WHEN 6 THEN '69002'
             WHEN 7 THEN '40000' WHEN 8 THEN '33000' WHEN 9 THEN '1200'
             ELSE '06000' END,
      cli_nationalities[i],
      prop_rents[i], 9.5, 6.0
    ) RETURNING id INTO v_client;
    client_ids := array_append(client_ids, v_client);
  END LOOP;

  -- ─── 2. BIENS (status=vendu) ───────────────────────────────────────
  FOR i IN 1..10 LOOP
    INSERT INTO properties (
      name, status, type, quartier, address,
      superficie, terrasse_m2, floor, nb_suites, has_elevator, has_parking,
      price, estimated_rent, agency_fees, notary_fees, travaux_budget_estimate,
      evaluation, badge_label, description,
      sourcing_commission_rate, sourcing_date, first_visit_date, offer_date,
      drive_url
    ) VALUES (
      prop_names[i], 'vendu', prop_types[i], prop_quartiers[i], prop_addresses[i],
      prop_superficies[i], prop_terrasses[i], prop_floors[i], prop_suites[i],
      (i % 2 = 0), (i % 3 = 0),
      prop_prices[i], prop_rents[i], prop_agency[i], prop_notary[i], prop_travaux[i],
      CASE WHEN i % 3 = 0 THEN 3 ELSE 2 END, prop_badges[i],
      'Bien d''exception au cœur de Marrakech. ' || prop_superficies[i] || ' m² habitables, '
        || prop_suites[i] || ' suites, terrasse de ' || prop_terrasses[i] || ' m². '
        || 'Quartier ' || prop_quartiers[i] || ', idéal pour location courte durée.',
      2.5,
      (CURRENT_DATE - INTERVAL '200 days')::date,
      (CURRENT_DATE - INTERVAL '180 days')::date,
      (CURRENT_DATE - INTERVAL '160 days')::date,
      'demo-seed'
    ) RETURNING id INTO v_property;
    property_ids := array_append(property_ids, v_property);
  END LOOP;

  -- ─── 3. PROJETS (créés en onboarding puis poussés en travaux) ──────
  FOR i IN 1..10 LOOP
    -- INSERT → trigger init_new_project crée la phase onboarding + acompte 5000€
    INSERT INTO projects (
      client_id, property_id, assigned_chef_projet,
      current_phase, status,
      travaux_budget, travaux_budget_mad, travaux_marge_cible_pct,
      travaux_adresse_chantier,
      stoniz_fees_acquisition, stoniz_fees_travaux
    ) VALUES (
      client_ids[i], property_ids[i], v_chef,
      'onboarding', 'actif',
      prop_travaux[i], prop_travaux[i] * 10, 30,
      prop_addresses[i],
      8800, 12200
    ) RETURNING id INTO v_project;
    project_ids := array_append(project_ids, v_project);

    -- Avance manuellement en phase travaux + remplit les dates
    UPDATE projects SET
      current_phase = 'travaux',
      onboarding_date       = (CURRENT_DATE - INTERVAL '180 days')::date,
      compromis_date        = (CURRENT_DATE - INTERVAL '130 days')::date,
      acte_authentique_date = (CURRENT_DATE - INTERVAL '90 days')::date,
      travaux_start_date    = (CURRENT_DATE - INTERVAL '60 days')::date,
      travaux_end_date      = (CURRENT_DATE + INTERVAL '45 days')::date
    WHERE id = v_project;

    -- Ferme l'onboarding auto-créé et insère sourcing/design/travaux
    UPDATE project_phases_history
      SET completed_at = (now() - INTERVAL '150 days')
      WHERE project_id = v_project AND phase = 'onboarding' AND completed_at IS NULL;

    INSERT INTO project_phases_history (project_id, phase, started_at, completed_at) VALUES
      (v_project, 'sourcing', now() - INTERVAL '150 days', now() - INTERVAL '100 days'),
      (v_project, 'design',   now() - INTERVAL '100 days', now() - INTERVAL '60 days'),
      (v_project, 'travaux',  now() - INTERVAL '60 days',  NULL);

    -- Marque l'acompte auto-créé comme payé
    UPDATE payments
      SET amount_paid = 5000, paid_at = (CURRENT_DATE - INTERVAL '170 days')::date,
          notes = '[DEMO] Acompte initial'
      WHERE project_id = v_project AND type = 'acompte_stoniz';

    -- Ajoute les 3 jalons intermédiaires (compromis, 3D, chantier)
    -- Les projets 1..7 ont payé le chantier ; les 8..10 sont en attente
    INSERT INTO payments (project_id, type, amount_expected, amount_paid, due_at_phase, due_date, paid_at, notes) VALUES
      (v_project, 'honoraires_compromis', 3800, 3800, 'sourcing',
        (CURRENT_DATE - INTERVAL '130 days')::date, (CURRENT_DATE - INTERVAL '128 days')::date,
        '[DEMO] Compromis payé'),
      (v_project, 'honoraires_3d', 3800, 3800, 'design',
        (CURRENT_DATE - INTERVAL '90 days')::date, (CURRENT_DATE - INTERVAL '85 days')::date,
        '[DEMO] Design payé'),
      (v_project, 'honoraires_chantier', 4200,
        CASE WHEN i <= 7 THEN 4200 ELSE 0 END, 'travaux',
        (CURRENT_DATE - INTERVAL '55 days')::date,
        CASE WHEN i <= 7 THEN (CURRENT_DATE - INTERVAL '50 days')::date ELSE NULL END,
        '[DEMO] Chantier');

    -- ─── 4. LOTS TRAVAUX (5 lots par projet) ─────────────────────────
    INSERT INTO travaux_lots (project_id, numero, category, description, artisan_name, artisan_type,
                              devis_number, budget_estimate_mad, devis_artisan_mad, facture_client_mad,
                              status, date_debut_estime, date_fin_estimee, date_fin_reelle, notes) VALUES
      (v_project, 1, 'demolition_cloisons',  '[DEMO] Démolition cloisons + curage',
        'Hassan Démolition SARL', 'artisan_local', 'DV-' || i || '-001',
        25000, 22000, 32000, 'termine',
        (CURRENT_DATE - INTERVAL '60 days')::date, (CURRENT_DATE - INTERVAL '50 days')::date,
        (CURRENT_DATE - INTERVAL '48 days')::date, '[DEMO] Lot terminé sans surprise'),

      (v_project, 2, 'gros_oeuvre_maconnerie', '[DEMO] Reprise cloisons + chapes',
        'Atlas Maçonnerie', 'entreprise_generale', 'DV-' || i || '-002',
        80000, 75000, 105000, 'en_cours',
        (CURRENT_DATE - INTERVAL '45 days')::date, (CURRENT_DATE + INTERVAL '5 days')::date,
        NULL, '[DEMO] Avancement 60%'),

      (v_project, 3, 'electricite', '[DEMO] Refonte installation électrique complète',
        'ElecPro Marrakech', 'sous_traitant_ext', 'DV-' || i || '-003',
        65000, 60000, 88000,
        CASE WHEN i % 2 = 0 THEN 'en_cours' ELSE 'en_attente' END,
        (CURRENT_DATE - INTERVAL '40 days')::date, (CURRENT_DATE + INTERVAL '10 days')::date,
        NULL, '[DEMO]'),

      (v_project, 4, 'plomberie_sanitaire', '[DEMO] Sanitaires + alimentation',
        'Aqua Plomb', 'artisan_local', 'DV-' || i || '-004',
        55000, 52000, 72000,
        CASE WHEN i <= 5 THEN 'devis_recu' ELSE 'a_planifier' END,
        (CURRENT_DATE - INTERVAL '20 days')::date, (CURRENT_DATE + INTERVAL '20 days')::date,
        NULL, '[DEMO]'),

      (v_project, 5, 'carrelage_revetements', '[DEMO] Carrelage + zellige SDB',
        'Zellige Frères', 'artisan_local', 'DV-' || i || '-005',
        70000, 68000, 96000, 'a_planifier',
        (CURRENT_DATE + INTERVAL '5 days')::date, (CURRENT_DATE + INTERVAL '35 days')::date,
        NULL, '[DEMO] Démarrage prévu après plomberie');

    -- ─── 5. ACOMPTES TRAVAUX (en MAD, taux 1 EUR = 10 MAD) ───────────
    -- Lot 1 (terminé) : 3 acomptes 40/40/20 payés
    INSERT INTO travaux_payments (project_id, lot_id, artisan_name, artisan_type, category,
      description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
      payment_type, status, acompte_number, acompte_pct, scheduled_date, paid_at, notes) VALUES
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 1),
        'Hassan Démolition SARL', 'artisan_local', 'autre',
        'Acompte 1/3 démolition', 'MAD', 8800, 8800, 10, now() - INTERVAL '58 days',
        'acompte', 'paid', 1, 40,
        (CURRENT_DATE - INTERVAL '58 days')::date, (CURRENT_DATE - INTERVAL '58 days')::date,
        '[DEMO] Acompte démarrage'),
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 1),
        'Hassan Démolition SARL', 'artisan_local', 'autre',
        'Acompte 2/3 démolition', 'MAD', 8800, 8800, 10, now() - INTERVAL '52 days',
        'acompte', 'paid', 2, 40,
        (CURRENT_DATE - INTERVAL '52 days')::date, (CURRENT_DATE - INTERVAL '52 days')::date,
        '[DEMO] Mi-parcours'),
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 1),
        'Hassan Démolition SARL', 'artisan_local', 'autre',
        'Solde démolition', 'MAD', 4400, 4400, 10, now() - INTERVAL '48 days',
        'solde', 'paid', 3, 20,
        (CURRENT_DATE - INTERVAL '48 days')::date, (CURRENT_DATE - INTERVAL '48 days')::date,
        '[DEMO] Solde final');

    -- Lot 2 (en_cours) : 2 acomptes payés, 1 prévu
    INSERT INTO travaux_payments (project_id, lot_id, artisan_name, artisan_type, category,
      description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
      payment_type, status, acompte_number, acompte_pct, scheduled_date, paid_at, notes) VALUES
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 2),
        'Atlas Maçonnerie', 'entreprise_generale', 'gros_oeuvre',
        'Acompte 1 maçonnerie', 'MAD', 30000, 30000, 10, now() - INTERVAL '44 days',
        'acompte', 'paid', 1, 40,
        (CURRENT_DATE - INTERVAL '44 days')::date, (CURRENT_DATE - INTERVAL '44 days')::date,
        '[DEMO]'),
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 2),
        'Atlas Maçonnerie', 'entreprise_generale', 'gros_oeuvre',
        'Acompte 2 maçonnerie', 'MAD', 30000, 30000, 10, now() - INTERVAL '25 days',
        'acompte', 'paid', 2, 40,
        (CURRENT_DATE - INTERVAL '25 days')::date, (CURRENT_DATE - INTERVAL '25 days')::date,
        '[DEMO]'),
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 2),
        'Atlas Maçonnerie', 'entreprise_generale', 'gros_oeuvre',
        'Solde maçonnerie', 'MAD', 15000, 0, 10, NULL,
        'solde', 'pending', 3, 20,
        (CURRENT_DATE + INTERVAL '5 days')::date, NULL,
        '[DEMO] Sera versé à la fin');

    -- Lot 3 (en_cours/en_attente) : 1 acompte payé
    INSERT INTO travaux_payments (project_id, lot_id, artisan_name, artisan_type, category,
      description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
      payment_type, status, acompte_number, acompte_pct, scheduled_date, paid_at, notes) VALUES
      (v_project, (SELECT id FROM travaux_lots WHERE project_id = v_project AND numero = 3),
        'ElecPro Marrakech', 'sous_traitant_ext', 'electricite',
        'Acompte 1 électricité', 'MAD', 24000, 24000, 10, now() - INTERVAL '38 days',
        'acompte', 'paid', 1, 40,
        (CURRENT_DATE - INTERVAL '38 days')::date, (CURRENT_DATE - INTERVAL '38 days')::date,
        '[DEMO] Démarrage installation');

    -- ─── 6. ENCAISSEMENTS CLIENT → STONIZ (MAD) ──────────────────────
    -- Le client a versé 2 fois pour couvrir les travaux
    INSERT INTO travaux_encaissements (project_id, amount_mad, received_at, payment_method, notes) VALUES
      (v_project, 120000, (CURRENT_DATE - INTERVAL '55 days')::date, 'virement',
        '[DEMO] Versement 1 client pour travaux'),
      (v_project,  80000, (CURRENT_DATE - INTERVAL '30 days')::date, 'virement',
        '[DEMO] Versement 2 client pour travaux');

  END LOOP;

  -- Reset des compteurs de propositions (pas nécessaire mais propre)
  UPDATE projects SET
    nb_properties_presented = 1,
    nb_properties_accepted  = 1
  WHERE id = ANY(project_ids);

  RAISE NOTICE 'Demo seed terminé : 10 clients, 10 biens, 10 projets en travaux, 50 lots, ~60 acomptes MAD';
END $$;
