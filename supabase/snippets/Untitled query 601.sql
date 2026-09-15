-- ─── Nettoyage des anciennes donnees demo (si elles existent) ──────────
DELETE FROM travaux_encaissements WHERE notes ILIKE '[DEMO]%';
DELETE FROM travaux_payments      WHERE notes ILIKE '[DEMO]%';
DELETE FROM travaux_lots          WHERE description ILIKE '[DEMO]%';
DELETE FROM payments              WHERE notes ILIKE '[DEMO]%';
DELETE FROM project_phases_history WHERE project_id IN (
  SELECT id FROM projects WHERE client_id IN (
    SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co'));
DELETE FROM projects WHERE client_id IN (
  SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co');
DELETE FROM properties WHERE drive_url = 'demo-seed';
DELETE FROM clients WHERE email LIKE '%@demo.stoniz.co';

-- ─── Insertion des donnees demo varieees ──────────────────────────────
DO $$
DECLARE
  client_ids   UUID[] := ARRAY[]::UUID[];
  property_ids UUID[] := ARRAY[]::UUID[];
  project_ids  UUID[] := ARRAY[]::UUID[];
  v_client     UUID;
  v_property   UUID;
  v_project    UUID;
  i            INTEGER;

  cli_first_names  TEXT[] := ARRAY['Mehdi','Sophie','Marc','Yasmine','Pierre','Julie','Karim','Elodie','Thomas','Camille'];
  cli_last_names   TEXT[] := ARRAY['Bennani','Laurent','Dubois','El Fassi','Lambert','Moreau','Tazi','Petit','Muller','Rousseau'];
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
  prop_terrasses   NUMERIC[] := ARRAY[20,35,18,45,25,30,12,22,40,15];
  prop_floors      TEXT[]    := ARRAY['RDC','3e','2e','5e','1er','4e','2e','3e','4e','2e'];
  prop_suites      INTEGER[] := ARRAY[3,3,2,4,4,3,2,3,3,2];
  prop_prices      NUMERIC[] := ARRAY[180000,145000,135000,235000,170000,160000,98000,142000,158000,128000];
  prop_rents       NUMERIC[] := ARRAY[1900,1800,1500,2500,2000,1700,1100,1750,1850,1450];
  prop_agency      NUMERIC[] := ARRAY[14400,11600,10800,18800,13600,12800,7840,11360,12640,10240];
  prop_notary      NUMERIC[] := ARRAY[12600,10150,9450,16450,11900,11200,6860,9940,11060,8960];
  prop_travaux     NUMERIC[] := ARRAY[55000,42000,38000,68000,50000,45000,28000,40000,46000,36000];
  prop_badges      TEXT[]    := ARRAY['Riad de caractere','Division en 2','Loft moderne','Penthouse vue ville','Division possible','Vue Atlas','Ideal courte duree','Standing','Recent','Elegance classique'];

  v_chef UUID;

  base_mad         NUMERIC;
  lot1_devis       NUMERIC;  lot1_facture NUMERIC;
  lot2_devis       NUMERIC;  lot2_facture NUMERIC;
  lot3_devis       NUMERIC;  lot3_facture NUMERIC;
  lot4_devis       NUMERIC;  lot4_facture NUMERIC;
  lot5_devis       NUMERIC;  lot5_facture NUMERIC;
  lot2_pct_paid    NUMERIC;
  lot3_pct_paid    NUMERIC;
  encaisse_1       NUMERIC;  encaisse_2 NUMERIC;
  days_offset      INTEGER;
  lot2_status      TEXT;
  lot3_status      TEXT;
  lot4_status      TEXT;

BEGIN
  SELECT id INTO v_chef FROM profiles
    WHERE role = 'chef_projet' AND is_active = true
    ORDER BY created_at LIMIT 1;
  IF v_chef IS NULL THEN
    SELECT id INTO v_chef FROM profiles WHERE role = 'ceo' AND is_active = true ORDER BY created_at LIMIT 1;
  END IF;

  FOR i IN 1..10 LOOP
    INSERT INTO clients (
      full_name, first_name, last_name, email, phone, nationality,
      budget_min, budget_max, available_savings, credit_type,
      location_preferences, property_type_preferences,
      consent_at, consent_version, onboarding_completed_at,
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
      (10 + i) || ' rue de la Republique',
      CASE i WHEN 1 THEN 'Casablanca' WHEN 2 THEN 'Lyon' WHEN 3 THEN 'Paris'
             WHEN 4 THEN 'Rabat' WHEN 5 THEN 'Bruxelles' WHEN 6 THEN 'Lyon'
             WHEN 7 THEN 'Marrakech' WHEN 8 THEN 'Bordeaux' WHEN 9 THEN 'Geneve'
             ELSE 'Nice' END,
      CASE i WHEN 1 THEN '20000' WHEN 2 THEN '69000' WHEN 3 THEN '75001'
             WHEN 4 THEN '10000' WHEN 5 THEN '1000' WHEN 6 THEN '69002'
             WHEN 7 THEN '40000' WHEN 8 THEN '33000' WHEN 9 THEN '1200'
             ELSE '06000' END,
      cli_nationalities[i],
      prop_rents[i], 8.5 + (i * 0.15), 5.5 + (i * 0.1)
    ) RETURNING id INTO v_client;
    client_ids := array_append(client_ids, v_client);
  END LOOP;

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
      'Bien d''exception au coeur de