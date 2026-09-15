DO $$
DECLARE
  client_ids   UUID[] := ARRAY[]::UUID[];
  property_ids UUID[] := ARRAY[]::UUID[];
  project_ids  UUID[] := ARRAY[]::UUID[];
  v_client     UUID;
  v_property   UUID;
  v_project    UUID;
  i            INTEGER;

  cli_full_names   TEXT[] := ARRAY[
    'Mehdi Bennani','Sophie Laurent','Marc Dubois','Yasmine El Fassi','Pierre Lambert',
    'Julie Moreau','Karim Tazi','Elodie Petit','Thomas Muller','Camille Rousseau'
  ];
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
  cli_nationalities TEXT[] := ARRAY['Marocaine','Francaise','Francaise','Marocaine','Belge','Francaise','Marocaine','Francaise','Suisse','Francaise'];
  cli_savings      NUMERIC[] := ARRAY[150000,80000,120000,95000,200000,60000,180000,75000,250000,90000];
  cli_budget_max   NUMERIC[] := ARRAY[280000,180000,220000,200000,350000,150000,320000,170000,420000,190000];

  prop_names       TEXT[] := ARRAY[
    'Riad Majorelle 86m2','Apt Hivernage 120m2','Loft Gueliz 95m2','Penthouse Victor Hugo 145m2',
    'Apt Semlalia Familial 130m2','Apt Route de Casa Vue Atlas','Apt Gueliz Cosy 75m2',
    'Apt Hivernage Standing','Apt Majorelle Recent 110m2','Apt Victor Hugo Elegance 88m2'
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
  prop_floors      TEXT[]    := ARRAY['RDC','3e','2e','5e','1er','4e','2e','3e','4e','2e'];
  prop_suites      INTEGER[] := ARRAY[3,3,2,4,4,3,2,3,3,2];
  prop_prices      NUMERIC[] := ARRAY[180000,145000,135000,235000,170000,160000,98000,142000,158000,128000];
  prop_rents       NUMERIC[] := ARRAY[1900,1800,1500,2500,2000,1700,1100,1750,1850,1450];
  prop_agency      NUMERIC[] := ARRAY[14400,11600,10800,18800,13600,12800,7840,11360,12640,10240];
  prop_notary      NUMERIC[] := ARRAY[12600,10150,9450,16450,11900,11200,6860,9940,11060,8960];
  prop_travaux     NUMERIC[] := ARRAY[55000,42000,38000,68000,50000,45000,28000,40000,46000,36000];

  v_chef UUID;

BEGIN
  SELECT id INTO v_chef FROM profiles
    WHERE role = 'chef_projet' AND is_active = true
    ORDER BY created_at LIMIT 1;

  FOR i IN 1..10 LOOP
    INSERT INTO clients (
      full_name, email, phone, nationality,
      budget_min, budget_max, available_savings, credit_type,
      location_preferences, property_type_preferences,
      consent_at, consent_version
    ) VALUES (
      cli_full_names[i], cli_emails[i], cli_phones[i], cli_nationalities[i],
      cli_savings[i] * 0.6, cli_budget_max[i], cli_savings[i],
      CASE WHEN i % 3 = 0 THEN 'yes' WHEN i % 5 = 0 THEN 'islamic' ELSE 'no' END,
      ARRAY['gueliz','hivernage','majorelle'], ARRAY['Appartement'],
      now() - INTERVAL '180 days', 'demo-seed'
    ) RETURNING id INTO v_client;
    client_ids := array_append(client_ids, v_client);
  END LOOP;

  FOR i IN 1..10 LOOP
    INSERT INTO properties (
      name, status, type, quartier, address,
      superficie, floor, nb_suites, has_elevator, has_parking,
      price, estimated_rent, agency_fees, notary_fees,
      evaluation,
      sourcing_commission_rate, sourcing_date, first_visit_date, offer_date,
      drive_url
    ) VALUES (
      prop_names[i], 'vendu', prop_types[i], prop_quartiers[i], prop_addresses[i],
      prop_superficies[i], prop_floors[i], prop_suites[i],
      (i % 2 = 0), (i % 3 = 0),
      prop_prices[i], prop_rents[i], prop_agency[i], prop_notary[i],
      CASE WHEN i % 3 = 0 THEN 3 ELSE 2 END,
      2.5,
      (CURRENT_DATE - INTERVAL '200 days')::date,
      (CURRENT_DATE - INTERVAL '180 days')::date,
      (CURRENT_DATE - INTERVAL '160 days')::date,
      'demo-seed'
    ) RETURNING id INTO v_property;
    property_ids := array_append(property_ids, v_property);
  END LOOP;

  FOR i IN 1..10 LOOP
    INSERT INTO projects (
      client_id, property_id, assigned_chef_projet,
      current_phase, status,
      travaux_budget,
      stoniz_fees_acquisition, stoniz_fees_travaux
    ) VALUES (
      client_ids[i], property_ids[i], v_chef,
      'onboarding', 'actif',
      prop_travaux[i],
      8800, 12200
    ) RETURNING id INTO v_project;
    project_ids := array_append(project_ids, v_project);

    UPDATE projects SET
      current_phase = 'travaux',
      onboarding_date       = (CURRENT_DATE - INTERVAL '180 days')::date,
      compromis_date        = (CURRENT_DATE - INTERVAL '130 days')::date,
      acte_authentique_date = (CURRENT_DATE - INTERVAL '90 days')::date,
      travaux_start_date    = (CURRENT_DATE - INTERVAL '60 days')::date,
      travaux_end_date      = (CURRENT_DATE + INTERVAL '45 days')::date
    WHERE id = v_project;

    UPDATE project_phases_history
      SET completed_at = (now() - INTERVAL '150 days')
      WHERE project_id = v_project AND phase = 'onboarding' AND completed_at IS NULL;

    INSERT INTO project_phases_history (project_id, phase, started_at, completed_at) VALUES
      (v_project, 'sourcing', now() - INTERVAL '150 days', now() - INTERVAL '100 days'),
      (v_project, 'design',   now() - INTERVAL '100 days', now() - INTERVAL '60 days'),
      (v_project, 'travaux',  now() - INTERVAL '60 days',  NULL);

    UPDATE payments
      SET amount_paid = 5000, paid_at = (CURRENT_DATE - INTERVAL '170 days')::date,
          notes = '[DEMO] Acompte initial'
      WHERE project_id = v_project AND type = 'acompte_stoniz';

    INSERT INTO payments (project_id, type, amount_expected, amount_paid, due_at_phase, due_date, paid_at, notes) VALUES
      (v_project, 'honoraires_compromis', 7600,
        CASE WHEN i <= 8 THEN 7600 ELSE 3800 END, 'sourcing',
        (CURRENT_DATE - INTERVAL '130 days')::date,
        CASE WHEN i <= 8 THEN (CURRENT_DATE - INTERVAL '128 days')::date ELSE NULL END,
        '[DEMO] Compromis + design (2x 3800)'),
      (v_project, 'honoraires_livraison', 8400,
        CASE WHEN i <= 7 THEN 4200 ELSE 0 END, 'travaux',
        (CURRENT_DATE - INTERVAL '55 days')::date,
        CASE WHEN i <= 7 THEN (CURRENT_DATE - INTERVAL '50 days')::date ELSE NULL END,
        '[DEMO] Chantier + livraison');

    INSERT INTO travaux_payments (project_id, artisan_name, artisan_type, category,
      description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
      payment_type, status, scheduled_date, paid_at, notes) VALUES
      (v_project, 'Hassan Demolition SARL', 'artisan_local', 'autre',
        '[DEMO] Demolition cloisons + curage (forfait)', 'MAD',
        22000, 22000, 10, now() - INTERVAL '58 days',
        'solde', 'paid',
        (CURRENT_DATE - INTERVAL '58 days')::date, (CURRENT_DATE - INTERVAL '48 days')::date,
        '[DEMO] Lot demolition termine'),
      (v_project, 'Atlas Maconnerie', 'entreprise_generale', 'gros_oeuvre',
        '[DEMO] Acompte 1 maconnerie', 'MAD',
        30000, 30000, 10, now() - INTERVAL '44 days',
        'acompte', 'paid',
        (CURRENT_DATE - INTERVAL '44 days')::date, (CURRENT_DATE - INTERVAL '44 days')::date,
        '[DEMO]'),
      (v_project, 'Atlas Maconnerie', 'entreprise_generale', 'gros_oeuvre',
        '[DEMO] Acompte 2 maconnerie', 'MAD',
        30000, 30000, 10, now() - INTERVAL '25 days',
        'acompte', 'paid',
        (CURRENT_DATE - INTERVAL '25 days')::date, (CURRENT_DATE - INTERVAL '25 days')::date,
        '[DEMO]'),
      (v_project, 'Atlas Maconnerie', 'entreprise_generale', 'gros_oeuvre',
        '[DEMO] Solde maconnerie', 'MAD',
        15000, 0, 10, NULL,
        'solde', 'pending',
        (CURRENT_DATE + INTERVAL '5 days')::date, NULL,
        '[DEMO] Sera verse a la fin'),
      (v_project, 'ElecPro Marrakech', 'sous_traitant_ext', 'electricite',
        '[DEMO] Acompte 1 electricite', 'MAD',
        24000, 24000, 10, now() - INTERVAL '38 days',
        'acompte', 'paid',
        (CURRENT_DATE - INTERVAL '38 days')::date, (CURRENT_DATE - INTERVAL '38 days')::date,
        '[DEMO] Demarrage installation'),
      (v_project, 'Aqua Plomb', 'artisan_local', 'plomberie',
        '[DEMO] Acompte 1 plomberie', 'MAD',
        20000, 20000, 10, now() - INTERVAL '20 days',
        'acompte', 'paid',
        (CURRENT_DATE - INTERVAL '20 days')::date, (CURRENT_DATE - INTERVAL '20 days')::date,
        '[DEMO]'),
      (v_project, 'Zellige Freres', 'artisan_local', 'autre',
        '[DEMO] Devis carrelage', 'MAD',
        68000, 0, 10, NULL,
        'acompte', 'pending',
        (CURRENT_DATE + INTERVAL '15 days')::date, NULL,
        '[DEMO] En attente demarrage');

  END LOOP;

  UPDATE projects SET
    nb_properties_presented = 1,
    nb_properties_accepted  = 1
  WHERE id = ANY(project_ids);

  RAISE NOTICE 'Demo seed minimal termine : 10 clients, 10 biens, 10 projets en travaux';
END $$;