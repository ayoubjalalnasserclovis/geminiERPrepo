-- Nettoyage prealable des donnees demo artisans + achats
DELETE FROM achats_encaissements WHERE notes ILIKE '[DEMO]%';
DELETE FROM achats_payments      WHERE notes ILIKE '[DEMO]%';
DELETE FROM achats_lots          WHERE description ILIKE '[DEMO]%';
UPDATE travaux_lots SET artisan_id = NULL
  WHERE description ILIKE '[DEMO]%';
DELETE FROM artisans WHERE notes ILIKE '[DEMO]%';

DO $$
DECLARE
  project_ids UUID[];
  v_project   UUID;
  i           INTEGER;

  -- Variables locales par projet
  base_achats_mad NUMERIC;
  lot1_devis NUMERIC; lot1_facture NUMERIC;
  lot2_devis NUMERIC; lot2_facture NUMERIC;
  lot3_devis NUMERIC; lot3_facture NUMERIC;
  lot4_devis NUMERIC; lot4_facture NUMERIC;
  lot5_devis NUMERIC; lot5_facture NUMERIC;
  encaisse_1 NUMERIC; encaisse_2 NUMERIC;
  v_lot1 UUID; v_lot2 UUID;

  -- IDs des artisans/fournisseurs (capturés a l'insertion)
  art_hassan UUID; art_atlas UUID; art_elec UUID; art_aqua UUID; art_zellige UUID;
  art_menuis UUID; art_alu UUID; art_peinture UUID; art_clim UUID; art_plafond UUID;
  four_mobilia UUID; four_marjane UUID; four_kitchen UUID; four_ikea UUID;
  four_marbre UUID; four_lighting UUID; four_textile UUID;

BEGIN

  -- ─── 1. ARTISANS (10 entreprises de travaux) ───────────────────────────
  INSERT INTO artisans (name, legal_form, type, speciality, ice, rc, contact_name, phone, whatsapp, email, city, country, bank_name, rib, status, evaluation, notes) VALUES
    ('Hassan Demolition SARL', 'sarl', 'artisan_local', 'demolition_cloisons',
      '001234567890123', 'RC-MA-12345', 'Hassan El Idrissi', '+212 6 61 11 22 33', '+212 6 61 11 22 33',
      'hassan@demolition.ma', 'Marrakech', 'Maroc', 'Attijariwafa Bank', '007780000123456789012345',
      'actif', 4, '[DEMO] Equipe rapide, fiable sur petits chantiers')
    RETURNING id INTO art_hassan;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, rc, contact_name, phone, email, city, country, bank_name, rib, status, evaluation, notes) VALUES
    ('Atlas Maconnerie', 'sarl', 'entreprise_generale', 'gros_oeuvre_maconnerie',
      '001234567890124', 'RC-MA-12346', 'Mohamed Alaoui', '+212 6 62 22 33 44',
      'contact@atlas-maconnerie.ma', 'Marrakech', 'Maroc', 'BMCE', '011780000223456789012345',
      'actif', 4, '[DEMO] Tres bon sur gros oeuvre, parfois en retard')
    RETURNING id INTO art_atlas;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, rc, contact_name, phone, email, city, country, status, evaluation, notes) VALUES
    ('ElecPro Marrakech', 'sas', 'sous_traitant_ext', 'electricite',
      '001234567890125', 'RC-MA-12347', 'Karim Tazi', '+212 6 63 33 44 55',
      'karim@elecpro.ma', 'Marrakech', 'Maroc', 'actif', 5, '[DEMO] Excellents finitions, conforme aux normes')
    RETURNING id INTO art_elec;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Aqua Plomb', 'personne_physique', 'artisan_local', 'plomberie_sanitaire',
      'Said Bennani', '+212 6 64 44 55 66', 'Marrakech', 'Maroc', 'actif', 3, '[DEMO] Correct, prevoir relances')
    RETURNING id INTO art_aqua;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Zellige Freres', 'sarl', 'artisan_local', 'carrelage_revetements',
      '001234567890127', 'Mehdi Zellige', '+212 6 65 55 66 77', 'Marrakech', 'Maroc',
      'actif', 5, '[DEMO] Spe zellige traditionnel, qualite exceptionnelle')
    RETURNING id INTO art_zellige;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Menuiserie El Idrissi', 'personne_physique', 'artisan_local', 'menuiserie_interieure',
      'Younes El Idrissi', '+212 6 66 66 77 88', 'Marrakech', 'Maroc', 'actif', 4, '[DEMO] Placards sur mesure top')
    RETURNING id INTO art_menuis;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, contact_name, phone, email, city, country, status, evaluation, notes) VALUES
    ('Alu Sud', 'sarl', 'entreprise_generale', 'menuiserie_aluminium',
      '001234567890129', 'Rachid Bouhassoun', '+212 6 67 77 88 99', 'info@alusud.ma',
      'Casablanca', 'Maroc', 'actif', 4, '[DEMO] Baies vitrees / fenetres')
    RETURNING id INTO art_alu;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Peinture & Decor Marrakech', 'auto_entrepreneur', 'artisan_local', 'peinture',
      'Hamid Ouahidi', '+212 6 68 88 99 00', 'Marrakech', 'Maroc', 'actif', 4, '[DEMO] Bonne finition murale')
    RETURNING id INTO art_peinture;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, contact_name, phone, email, city, country, status, evaluation, notes) VALUES
    ('Climatech Pro', 'sarl', 'sous_traitant_ext', 'climatisation_vmc',
      '001234567890131', 'Walid Berrada', '+212 6 69 99 00 11', 'walid@climatech.ma',
      'Casablanca', 'Maroc', 'actif', 5, '[DEMO] Daikin/Mitsubishi certifies')
    RETURNING id INTO art_clim;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Faux Plafond Plus', 'personne_physique', 'artisan_local', 'faux_plafond',
      'Ismail Naciri', '+212 6 60 00 11 22', 'Marrakech', 'Maroc', 'actif', 3, '[DEMO] Standard, ok')
    RETURNING id INTO art_plafond;

  -- ─── 2. FOURNISSEURS (7 societes vendeuses de biens) ───────────────────
  INSERT INTO artisans (name, legal_form, type, speciality, ice, contact_name, phone, email, city, country, status, evaluation, notes) VALUES
    ('Mobilia Maroc', 'sa', 'fournisseur', 'divers',
      '001234567890201', 'Sara Lamrani', '+212 5 22 11 22 33', 'pro@mobilia.ma',
      'Casablanca', 'Maroc', 'actif', 5, '[DEMO] Mobilier salon/chambre, delais 2-3 sem')
    RETURNING id INTO four_mobilia;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Marjane Hyper Marrakech', 'sa', 'grossiste', 'divers',
      'Service pro', '+212 5 24 30 40 50', 'Marrakech', 'Maroc', 'actif', 4, '[DEMO] Vaisselle, electromenager, linge')
    RETURNING id INTO four_marjane;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, contact_name, phone, email, city, country, status, evaluation, notes) VALUES
    ('KitchenLab Casa', 'sarl', 'fournisseur', 'cuisine',
      '001234567890203', 'Adil Senhaji', '+212 6 11 22 33 44', 'adil@kitchenlab.ma',
      'Casablanca', 'Maroc', 'actif', 5, '[DEMO] Cuisines sur mesure haut de gamme')
    RETURNING id INTO four_kitchen;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('IKEA Marrakech', 'sa', 'fournisseur', 'divers',
      'Service pro', '+212 5 24 50 60 70', 'Marrakech', 'Maroc', 'actif', 4, '[DEMO] Mobilier rapport qualite/prix')
    RETURNING id INTO four_ikea;

  INSERT INTO artisans (name, legal_form, type, speciality, ice, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Marbre Express', 'sarl', 'importateur', 'carrelage_revetements',
      '001234567890205', 'Hassan Marbre', '+212 6 22 33 44 55', 'Marrakech', 'Maroc',
      'actif', 5, '[DEMO] Marbre italien et turc, import direct')
    RETURNING id INTO four_marbre;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, email, city, country, status, evaluation, notes) VALUES
    ('Lighting Atlas', 'sarl', 'fournisseur', 'divers',
      'Layla Cherkaoui', '+212 6 33 44 55 66', 'layla@lightingatlas.ma',
      'Marrakech', 'Maroc', 'actif', 4, '[DEMO] Luminaires design + LED')
    RETURNING id INTO four_lighting;

  INSERT INTO artisans (name, legal_form, type, speciality, contact_name, phone, city, country, status, evaluation, notes) VALUES
    ('Cosmetex Linge Maison', 'sarl', 'fournisseur', 'divers',
      'Fatima Zahra', '+212 6 44 55 66 77', 'Casablanca', 'Maroc', 'actif', 4, '[DEMO] Draps, serviettes, rideaux')
    RETURNING id INTO four_textile;

  -- ─── 3. Lier les travaux_lots existants aux artisans (par nom) ─────────
  UPDATE travaux_lots SET artisan_id = art_hassan
    WHERE description ILIKE '[DEMO]%' AND artisan_name = 'Hassan Demolition SARL';
  UPDATE travaux_lots SET artisan_id = art_atlas
    WHERE description ILIKE '[DEMO]%' AND artisan_name = 'Atlas Maconnerie';
  UPDATE travaux_lots SET artisan_id = art_elec
    WHERE description ILIKE '[DEMO]%' AND artisan_name = 'ElecPro Marrakech';
  UPDATE travaux_lots SET artisan_id = art_aqua
    WHERE description ILIKE '[DEMO]%' AND artisan_name = 'Aqua Plomb';
  UPDATE travaux_lots SET artisan_id = art_zellige
    WHERE description ILIKE '[DEMO]%' AND artisan_name = 'Zellige Freres';

  -- Mise a jour des KPIs cumulees sur les artisans (nb_lots + ca_total)
  UPDATE artisans a SET
    nb_lots_total = COALESCE((SELECT COUNT(*) FROM travaux_lots WHERE artisan_id = a.id AND deleted_at IS NULL), 0),
    ca_total_mad  = COALESCE((SELECT SUM(facture_client_mad) FROM travaux_lots WHERE artisan_id = a.id AND deleted_at IS NULL), 0)
  WHERE notes ILIKE '[DEMO]%';

  -- ─── 4. ACHATS LOTS + paiements + encaissements par projet ─────────────
  SELECT array_agg(p.id ORDER BY p.created_at)
    INTO project_ids
    FROM projects p
    JOIN clients c ON c.id = p.client_id
    WHERE c.email LIKE '%@demo.stoniz.co'
      AND p.deleted_at IS NULL;

  IF project_ids IS NULL OR array_length(project_ids, 1) IS NULL THEN
    RAISE NOTICE 'Aucun projet demo trouve : lance dabord demo_seed_clean.sql';
    RETURN;
  END IF;

  FOR i IN 1..array_length(project_ids, 1) LOOP
    v_project := project_ids[i];

    -- Recupere le budget travaux pour deriver le budget achats (50% du budget travaux)
    SELECT (travaux_budget_mad * 0.5) INTO base_achats_mad
      FROM projects WHERE id = v_project;
    IF base_achats_mad IS NULL OR base_achats_mad = 0 THEN
      base_achats_mad := 200000;  -- fallback
    END IF;

    -- Set budget global achats sur le projet
    UPDATE projects SET
      achats_budget_mad = base_achats_mad,
      achats_marge_cible_pct = 25,
      achats_adresse_livraison = travaux_adresse_chantier
    WHERE id = v_project;

    -- Repartition lots (% du budget)
    lot1_devis   := ROUND(base_achats_mad * 0.18, 0);  lot1_facture := ROUND(base_achats_mad * 0.24, 0);   -- mobilier salon
    lot2_devis   := ROUND(base_achats_mad * 0.22, 0);  lot2_facture := ROUND(base_achats_mad * 0.30, 0);   -- mobilier chambres
    lot3_devis   := ROUND(base_achats_mad * 0.16, 0);  lot3_facture := ROUND(base_achats_mad * 0.21, 0);   -- electromenager
    lot4_devis   := ROUND(base_achats_mad * 0.08, 0);  lot4_facture := ROUND(base_achats_mad * 0.11, 0);   -- luminaires
    lot5_devis   := ROUND(base_achats_mad * 0.10, 0);  lot5_facture := ROUND(base_achats_mad * 0.14, 0);   -- textile

    -- Encaissements client
    encaisse_1 := ROUND((lot1_facture + lot2_facture) * 0.6, 0);
    encaisse_2 := ROUND((lot3_facture + lot4_facture) * 0.5, 0);

    -- Lots achats (5 par projet)
    INSERT INTO achats_lots (project_id, numero, category, description, supplier_name, supplier_id,
                             devis_number, budget_estimate_mad, devis_fournisseur_mad, facture_client_mad,
                             status, date_commande, date_livraison_estimee, date_livraison_reelle, notes) VALUES
      (v_project, 1, 'mobilier_salon', '[DEMO] Salon complet (canape, table basse, console TV)',
        'Mobilia Maroc', four_mobilia, 'BC-' || i || '-001',
        ROUND(base_achats_mad * 0.20, 0), lot1_devis, lot1_facture,
        CASE WHEN i <= 4 THEN 'livre' WHEN i <= 7 THEN 'en_livraison' ELSE 'commande' END,
        (CURRENT_DATE - INTERVAL '45 days')::date,
        (CURRENT_DATE - INTERVAL '10 days')::date,
        CASE WHEN i <= 4 THEN (CURRENT_DATE - INTERVAL '8 days')::date END,
        '[DEMO] Lot prioritaire')
      RETURNING id INTO v_lot1;

    INSERT INTO achats_lots (project_id, numero, category, description, supplier_name, supplier_id,
                             devis_number, budget_estimate_mad, devis_fournisseur_mad, facture_client_mad,
                             status, date_commande, date_livraison_estimee, notes) VALUES
      (v_project, 2, 'mobilier_chambre', '[DEMO] Mobilier chambres (lits, armoires, chevets)',
        'IKEA Marrakech', four_ikea, 'BC-' || i || '-002',
        ROUND(base_achats_mad * 0.25, 0), lot2_devis, lot2_facture,
        CASE WHEN i <= 3 THEN 'livre' WHEN i <= 6 THEN 'commande' ELSE 'a_commander' END,
        CASE WHEN i <= 6 THEN (CURRENT_DATE - INTERVAL '30 days')::date END,
        (CURRENT_DATE + INTERVAL '15 days')::date,
        '[DEMO]')
      RETURNING id INTO v_lot2;

    INSERT INTO achats_lots (project_id, numero, category, description, supplier_name, supplier_id,
                             devis_number, budget_estimate_mad, devis_fournisseur_mad, facture_client_mad,
                             status, date_commande, date_livraison_estimee, notes) VALUES
      (v_project, 3, 'electromenager', '[DEMO] Electromenager (frigo, four, lave-linge, micro-ondes)',
        'Marjane Hyper Marrakech', four_marjane, 'BC-' || i || '-003',
        ROUND(base_achats_mad * 0.18, 0), lot3_devis, lot3_facture,
        CASE WHEN i <= 5 THEN 'commande' WHEN i <= 8 THEN 'devis_recu' ELSE 'a_commander' END,
        CASE WHEN i <= 5 THEN (CURRENT_DATE - INTERVAL '15 days')::date END,
        (CURRENT_DATE + INTERVAL '20 days')::date,
        '[DEMO]'),

      (v_project, 4, 'luminaire', '[DEMO] Luminaires LED + lustres salon',
        'Lighting Atlas', four_lighting, 'BC-' || i || '-004',
        ROUND(base_achats_mad * 0.10, 0), lot4_devis, lot4_facture,
        CASE WHEN i <= 6 THEN 'devis_recu' ELSE 'a_commander' END,
        NULL,
        (CURRENT_DATE + INTERVAL '30 days')::date,
        '[DEMO]'),

      (v_project, 5, 'textile_decoration', '[DEMO] Linge maison + decoration (rideaux, coussins, art mural)',
        'Cosmetex Linge Maison', four_textile, 'BC-' || i || '-005',
        ROUND(base_achats_mad * 0.12, 0), lot5_devis, lot5_facture,
        'a_commander',
        NULL,
        (CURRENT_DATE + INTERVAL '40 days')::date,
        '[DEMO] A confirmer apres validation moodboard client');

    -- ─── 5. ACOMPTES FOURNISSEURS (en MAD) ───────────────────────────────
    -- Lot 1 (mobilier salon) : acompte 50% paye + solde 50% paye (sauf projets non livres)
    INSERT INTO achats_payments (project_id, lot_id, supplier_name, supplier_id, category,
      description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
      payment_type, status, acompte_number, acompte_pct, scheduled_date, paid_at, notes) VALUES
      (v_project, v_lot1, 'Mobilia Maroc', four_mobilia, 'mobilier_salon',
        'Acompte commande mobilier salon', 'MAD',
        ROUND(lot1_devis * 0.50, 0), ROUND(lot1_devis * 0.50, 0), 10, now() - INTERVAL '44 days',
        'acompte', 'paid', 1, 50,
        (CURRENT_DATE - INTERVAL '44 days')::date, (CURRENT_DATE - INTERVAL '44 days')::date,
        '[DEMO] Acompte a la commande'),
      (v_project, v_lot1, 'Mobilia Maroc', four_mobilia, 'mobilier_salon',
        'Solde a la livraison', 'MAD',
        ROUND(lot1_devis * 0.50, 0),
        CASE WHEN i <= 4 THEN ROUND(lot1_devis * 0.50, 0) ELSE 0 END,
        10,
        CASE WHEN i <= 4 THEN now() - INTERVAL '8 days' END,
        'solde',
        CASE WHEN i <= 4 THEN 'paid' ELSE 'pending' END, 2, 50,
        (CURRENT_DATE - INTERVAL '5 days')::date,
        CASE WHEN i <= 4 THEN (CURRENT_DATE - INTERVAL '8 days')::date END,
        '[DEMO]');

    -- Lot 2 (mobilier chambres IKEA) : 100% paye d'avance
    IF i <= 6 THEN
      INSERT INTO achats_payments (project_id, lot_id, supplier_name, supplier_id, category,
        description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
        payment_type, status, acompte_number, acompte_pct, scheduled_date, paid_at, notes) VALUES
        (v_project, v_lot2, 'IKEA Marrakech', four_ikea, 'mobilier_chambre',
          'Paiement comptant IKEA', 'MAD', lot2_devis, lot2_devis, 10, now() - INTERVAL '30 days',
          'solde', 'paid', 1, 100,
          (CURRENT_DATE - INTERVAL '30 days')::date, (CURRENT_DATE - INTERVAL '30 days')::date,
          '[DEMO] Paiement total IKEA');
    END IF;

    -- Lot 3 (electromenager Marjane) : acompte 30% paye seulement pour projets 1..5
    IF i <= 5 THEN
      INSERT INTO achats_payments (project_id, lot_id, supplier_name, supplier_id, category,
        description, currency, amount_total, amount_paid, exchange_rate_eur, exchange_rate_at,
        payment_type, status, acompte_number, acompte_pct, scheduled_date, paid_at, notes) VALUES
        (v_project, (SELECT id FROM achats_lots WHERE project_id = v_project AND numero = 3),
          'Marjane Hyper Marrakech', four_marjane, 'electromenager',
          'Acompte electromenager', 'MAD',
          ROUND(lot3_devis * 0.30, 0), ROUND(lot3_devis * 0.30, 0), 10, now() - INTERVAL '15 days',
          'acompte', 'paid', 1, 30,
          (CURRENT_DATE - INTERVAL '15 days')::date, (CURRENT_DATE - INTERVAL '15 days')::date,
          '[DEMO]'),
        (v_project, (SELECT id FROM achats_lots WHERE project_id = v_project AND numero = 3),
          'Marjane Hyper Marrakech', four_marjane, 'electromenager',
          'Solde electromenager (livraison)', 'MAD',
          ROUND(lot3_devis * 0.70, 0), 0, 10, NULL,
          'solde', 'pending', 2, 70,
          (CURRENT_DATE + INTERVAL '15 days')::date, NULL,
          '[DEMO]');
    END IF;

    -- ─── 6. ENCAISSEMENTS CLIENT (achats) ────────────────────────────────
    IF encaisse_1 > 0 THEN
      INSERT INTO achats_encaissements (project_id, amount_mad, received_at, payment_method, notes) VALUES
        (v_project, encaisse_1, (CURRENT_DATE - INTERVAL '50 days')::date, 'virement',
          '[DEMO] Versement 1 client - achats');
    END IF;
    IF encaisse_2 > 0 AND i <= 7 THEN
      INSERT INTO achats_encaissements (project_id, amount_mad, received_at, payment_method, notes) VALUES
        (v_project, encaisse_2, (CURRENT_DATE - INTERVAL '20 days')::date, 'virement',
          '[DEMO] Versement 2 client - achats');
    END IF;
    IF i <= 3 THEN
      INSERT INTO achats_encaissements (project_id, amount_mad, received_at, payment_method, notes) VALUES
        (v_project, ROUND(base_achats_mad * 0.20, 0), (CURRENT_DATE - INTERVAL '5 days')::date, 'virement',
          '[DEMO] Versement complementaire client');
    END IF;

  END LOOP;

  -- Recalcul des KPIs artisans (ca_total inclut maintenant les achats aussi via lien supplier_id)
  UPDATE artisans a SET
    nb_lots_total = (
      COALESCE((SELECT COUNT(*) FROM travaux_lots WHERE artisan_id = a.id AND deleted_at IS NULL), 0) +
      COALESCE((SELECT COUNT(*) FROM achats_lots  WHERE supplier_id = a.id AND deleted_at IS NULL), 0)
    ),
    ca_total_mad = (
      COALESCE((SELECT SUM(facture_client_mad) FROM travaux_lots WHERE artisan_id = a.id AND deleted_at IS NULL), 0) +
      COALESCE((SELECT SUM(facture_client_mad) FROM achats_lots  WHERE supplier_id = a.id AND deleted_at IS NULL), 0)
    )
  WHERE notes ILIKE '[DEMO]%';

  RAISE NOTICE 'Demo seed artisans+achats termine : 17 artisans/fournisseurs, % projets enrichis avec 5 lots achats chacun', array_length(project_ids, 1);
END $$;