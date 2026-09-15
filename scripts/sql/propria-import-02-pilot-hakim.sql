-- ============================================================================
-- IMPORT PROPRIA — Pilote Hakim Boucheniata
-- ============================================================================
-- Client : cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd (BOUCHENIATA Hakim - BEJ GUENI)
-- Décisions actées :
--   - 3 biens à gérer : AF (ALLAL FASSI), MAJO (MAJORELLA), BEJ GUENI
--   - AF + MAJO : nouvelles properties + nouveaux projets PROPRIA legacy
--   - BEJ GUENI : on RÉUTILISE le projet 'boucheniata-hakim-bej-gueni' existant
--     et on UPDATE sa property avec les données PROPRIA
--   - RIAD 1 : on NE TOUCHE PAS (projet en cours non livré)
--
-- Stratégie projets PROPRIA legacy (Option A validée) :
--   current_phase = 'mise_en_location', status = 'actif',
--   is_preparation = false, legacy_imported = true
--
-- Side effect attendu : init_new_project trigger va créer un acompte 5000 €
-- et des tâches onboarding pour chaque INSERT projects. On les NETTOIE
-- à la fin (ils n'ont pas de sens pour un projet PROPRIA legacy).
--
-- Tout en une transaction → rollback auto si erreur.
-- ============================================================================

DO $$
DECLARE
  v_client_id UUID := 'cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd';
  v_client_phone TEXT;
  v_property_af UUID;
  v_property_majo UUID;
  v_property_bejgueni UUID;
  v_project_af UUID;
  v_project_majo UUID;
  v_project_bejgueni UUID;
  v_owner_name TEXT := 'Hakim Boucheniata';
  v_owner_email TEXT := 'boucheniata.hakim@gmail.com';
BEGIN
  -- Récupérer le téléphone existant du client
  SELECT phone INTO v_client_phone FROM clients WHERE id = v_client_id;

  -- ─────────────────────────────────────────────────────────────────────────
  -- BIEN 1 — AF (ALLAL EL FASSI)  [NOUVEAU]
  -- ─────────────────────────────────────────────────────────────────────────

  INSERT INTO properties (
    name, address, type,
    propria_managed_at, propria_internal_code,
    propria_owner_name, propria_owner_phone, propria_owner_email,
    propria_google_maps_url, propria_apartment_door,
    propria_commission_rate,
    propria_building_access_type, propria_access_admin,
    propria_arrival_video_url,
    propria_camera_installed, propria_app_admin_access,
    propria_info_sheet_to_send,
    propria_syndic_to_pay,
    -- Eau/Elec/Internet : "Client paie" → on stocke le marker
    propria_water_contract, propria_electricity_contract, propria_internet_contract
  ) VALUES (
    'AF — AV Allal el Fassi (Hakim)',
    'AV ALLAL EL FASSI IM D APPT 7 ETAGE 2',
    'Appartement',
    now(),
    'AF',
    v_owner_name, v_client_phone, v_owner_email,
    'https://maps.app.goo.gl/RP5DZmFRx4FHka1K7?g_st=com.google.maps.preview.copy',
    '7',
    20.00,
    'ouvert_24_24',
    'Oui',
    'https://drive.google.com/file/d/1BjH89_lcDLyZuavoPFU0r1_Md4LZ7lZ-/view?usp=drive_link',
    true,  -- camera installée (CSV : Oui)
    true,  -- app admin access (CSV : Oui)
    false, -- info sheet (vide CSV)
    false, -- syndic à payer (vide CSV)
    'client_paie', 'client_paie', 'client_paie'
  ) RETURNING id INTO v_property_af;

  -- Projet PROPRIA legacy lié
  INSERT INTO projects (
    client_id, property_id,
    current_phase, status,
    is_preparation, legacy_imported,
    activated_at
  ) VALUES (
    v_client_id, v_property_af,
    'mise_en_location', 'actif',
    false, true,
    now()  -- déjà activé puisqu'on l'importe directement
  ) RETURNING id INTO v_project_af;

  -- Nettoyage des artefacts auto-générés par init_new_project trigger
  DELETE FROM payments WHERE project_id = v_project_af;
  DELETE FROM tasks WHERE project_id = v_project_af;
  DELETE FROM project_phases_history WHERE project_id = v_project_af;
  INSERT INTO project_phases_history (project_id, phase, started_at, completed_at)
    VALUES (v_project_af, 'mise_en_location', now(), NULL);

  -- 4 lots AF
  INSERT INTO propria_units (
    property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres, propria_type_lits,
    propria_smart_lock, propria_lock_code,
    propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url,
    propria_app_admin_access
  ) VALUES
    (v_property_af, 1, 'AF 1', true, '7', 2, 1, '160*200', true, '552370#',
     '1010', 2, 'HUAWEI-5G- KcE9', 'v5SAfnzW',
     'https://fr.airbnb.com/rooms/1405720779150362303', 429.00,
     'https://drive.google.com/drive/folders/1ZEeEvYwy0GHDfHA-6SQf0FGq6I0Habw3?usp=drive_link', true),
    (v_property_af, 2, 'AF 2', true, '7', 2, 1, NULL, true, '552370#',
     '2020', 2, 'HUAWEI-5G- KcE9', 'v5SAfnzW',
     'https://fr.airbnb.com/rooms/1405736007421083796', 400.00,
     'https://drive.google.com/drive/folders/1VmNAk50stjTWpt6WxqpRsKgJIX7eiF9Z?usp=drive_link', true),
    (v_property_af, 3, 'AF 3', true, '7', 2, 1, NULL, true, '552370#',
     '3030', NULL, 'HUAWEI-5G- KcE9', 'v5SAfnzW',
     'https://fr.airbnb.com/rooms/1405739609156077084', 429.00,
     'https://drive.google.com/drive/folders/1CHViH2POx9dDgQODHaWJOqh2nkcIfedl?usp=drive_link', true),
    (v_property_af, 4, 'AF 4', true, '7', 2, 1, NULL, true, '552370#',
     '4040', NULL, 'HUAWEI-5G- KcE9', 'v5SAfnzW',
     'https://fr.airbnb.com/rooms/1405760262502155868', 399.00,
     'https://drive.google.com/drive/folders/1QviYGf4_ngR9JVN8-8j3e7Dq1n-gIHfD?usp=drive_link', true);

  RAISE NOTICE 'AF : property % + projet % + 4 lots créés', v_property_af, v_project_af;

  -- ─────────────────────────────────────────────────────────────────────────
  -- BIEN 2 — MAJO (MAJORELLA)  [NOUVEAU]
  -- ─────────────────────────────────────────────────────────────────────────

  INSERT INTO properties (
    name, address, type, floor,
    propria_managed_at, propria_internal_code,
    propria_owner_name, propria_owner_phone, propria_owner_email,
    propria_google_maps_url, propria_apartment_door,
    propria_commission_rate,
    propria_building_access_type, propria_access_admin,
    propria_arrival_video_url,
    propria_camera_installed, propria_app_admin_access,
    propria_info_sheet_to_send,
    propria_syndic_to_pay, propria_syndic_amount,
    propria_water_contract, propria_electricity_contract, propria_internet_contract
  ) VALUES (
    'MAJO — Résidence Majorella (Hakim)',
    'Rue Bata, 115 Résidence Majorella, appartement n°15, 5ème étage.',
    'Appartement',
    5,
    now(), 'MAJO',
    v_owner_name, v_client_phone, v_owner_email,
    'https://maps.app.goo.gl/dQ9ZgTkau6Mq35qX7',
    '15',
    20.00,
    'badge_asc_cle',
    'Oui',
    'https://drive.google.com/file/d/16VR2nwEdmjR7DwiKB2C7Jlwdtu6MjmvY/view?usp=drive_link',
    true, true,
    false,
    true, 250.00,  -- 3000 MAD/an → 250 MAD/mois
    'client_paie', 'client_paie', 'client_paie'
  ) RETURNING id INTO v_property_majo;

  INSERT INTO projects (
    client_id, property_id, current_phase, status,
    is_preparation, legacy_imported, activated_at
  ) VALUES (
    v_client_id, v_property_majo, 'mise_en_location', 'actif',
    false, true, now()
  ) RETURNING id INTO v_project_majo;

  DELETE FROM payments WHERE project_id = v_project_majo;
  DELETE FROM tasks WHERE project_id = v_project_majo;
  DELETE FROM project_phases_history WHERE project_id = v_project_majo;
  INSERT INTO project_phases_history (project_id, phase, started_at, completed_at)
    VALUES (v_project_majo, 'mise_en_location', now(), NULL);

  INSERT INTO propria_units (
    property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code,
    propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url,
    propria_app_admin_access
  ) VALUES
    (v_property_majo, 1, 'MAJO 1', true, '15', 2, 1, true, '369870#',
     '1000', 2, 'HUAWEI-5G-s6Pq', 'Ycc2NtWU',
     'https://fr.airbnb.com/rooms/1320867109662644952', 519.00,
     'https://drive.google.com/drive/folders/1Lp2BjBr-DbADsaoFHvnkbA2uEumSWqc6?usp=drive_link', true),
    (v_property_majo, 2, 'MAJO 2', true, '15', 2, 1, true, '369870#',
     '2000', 6, 'HUAWEI-5G-s6Pq', 'Ycc2NtWU',
     'https://fr.airbnb.com/rooms/1320952348323648865', 599.00,
     'https://drive.google.com/drive/folders/1lZ-fqytlC977HkJJAzzP-FfSMQHRs1aW?usp=drive_link', true),
    (v_property_majo, 3, 'MAJO 3', true, '15', 2, 1, true, '369870#',
     '3000', 4, 'HUAWEI-5G-s6Pq', 'Ycc2NtWU',
     'https://fr.airbnb.com/rooms/1320965990927346597', 699.00,
     'https://drive.google.com/drive/folders/1auCniIUngOFxY9zjfGA1W0OaLXOx3RLI?usp=drive_link', true);

  RAISE NOTICE 'MAJO : property % + projet % + 3 lots créés', v_property_majo, v_project_majo;

  -- ─────────────────────────────────────────────────────────────────────────
  -- BIEN 3 — BEJ GUENI  [EXISTANT : on UPDATE la property liée au projet]
  -- ─────────────────────────────────────────────────────────────────────────

  -- Identifier la property existante
  SELECT p.id, p.property_id INTO v_project_bejgueni, v_property_bejgueni
  FROM projects p
  WHERE p.code = 'boucheniata-hakim-bej-gueni'
    AND p.deleted_at IS NULL
  LIMIT 1;

  IF v_property_bejgueni IS NULL THEN
    RAISE EXCEPTION 'Property liée au projet boucheniata-hakim-bej-gueni introuvable';
  END IF;

  -- UPDATE non-destructif : on remplit les champs PROPRIA + propria_managed_at
  -- On NE touche PAS au name/address existants (potentiellement déjà remplis)
  UPDATE properties SET
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'BEJ GUENI'),
    propria_owner_name = COALESCE(propria_owner_name, v_owner_name),
    propria_owner_phone = COALESCE(propria_owner_phone, v_client_phone),
    propria_owner_email = COALESCE(propria_owner_email, v_owner_email),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/DccEG4CmCynUenLN9?g_st=com.google.maps.preview.copy'),
    propria_apartment_door = COALESCE(propria_apartment_door, '9'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Non'),
    propria_arrival_video_url = COALESCE(propria_arrival_video_url, 'https://drive.google.com/file/d/1XJMdDZEWB-aIp5fWXQ3YuNIymL9Hge_7/view?usp=drive_link'),
    propria_camera_installed = true,
    propria_app_admin_access = true,
    propria_syndic_to_pay = true,
    propria_syndic_amount = COALESCE(propria_syndic_amount, 150.00),
    propria_water_contract = COALESCE(propria_water_contract, 'client_paie'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, 'client_paie'),
    propria_internet_contract = COALESCE(propria_internet_contract, 'client_paie')
  WHERE id = v_property_bejgueni;

  INSERT INTO propria_units (
    property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code,
    propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url,
    propria_app_admin_access
  ) VALUES
    (v_property_bejgueni, 1, 'BEJ GUENI 1', true, '9', 2, 1, true, '6665755#',
     '7071', 4, 'Huawei-2.4G-kg7y', '7kHJ6mzh',
     'https://fr.airbnb.com/rooms/1399540538455654919', 399.00,
     'https://drive.google.com/drive/folders/1UGJpzUHpAJwKaYN7vE5-GyzRrxEhkYHo?usp=drive_link', true),
    (v_property_bejgueni, 2, 'BEJ GUENI 2', true, '9', 2, 1, true, '6665755#',
     '7072', NULL, 'Huawei-2.4G-kg7y', '7kHJ6mzh',
     'https://fr.airbnb.com/rooms/1404454381102182589', 400.00,
     'https://drive.google.com/drive/folders/1iAWn2QpHYNkw72-2Q-tkPw1nPEtmLpN-?usp=drive_link', true),
    (v_property_bejgueni, 3, 'BEJ GUENI 3', true, '9', 2, 1, true, '6665755#',
     '7073', NULL, 'Huawei-2.4G-kg7y', '7kHJ6mzh',
     'https://fr.airbnb.com/rooms/1405711233070244834', 429.00,
     'https://drive.google.com/drive/folders/11yC8WXWmZG0PrRQgiZ-5Xic3ppC_D6QD?usp=drive_link', true),
    (v_property_bejgueni, 4, 'BEJ GUENI 4', true, '9', 2, 1, true, '6665755#',
     '7074', NULL, 'Huawei-2.4G-kg7y', '7kHJ6mzh',
     'https://fr.airbnb.com/rooms/1405714459707788952', 449.00,
     'https://drive.google.com/drive/folders/1oE2GSCK7vCOmRgR0GCBxsVwhYEor1dDB?usp=drive_link', true);

  RAISE NOTICE 'BEJ GUENI : property % réutilisée + 4 lots créés', v_property_bejgueni;
  RAISE NOTICE 'Pilote Hakim TERMINÉ avec succès.';
END $$;

-- ─── Vérifications post-pilote ──────────────────────────────────────────────
SELECT
  '📊 Récap pilote Hakim' AS info,
  (SELECT COUNT(*) FROM properties p
   JOIN projects pj ON pj.property_id = p.id
   WHERE pj.client_id = 'cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd'
   AND p.deleted_at IS NULL AND pj.deleted_at IS NULL
   AND p.propria_managed_at IS NOT NULL) AS nb_properties_propria,

  (SELECT COUNT(*) FROM propria_units u
   JOIN properties p ON p.id = u.property_id
   JOIN projects pj ON pj.property_id = p.id
   WHERE pj.client_id = 'cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd'
   AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND pj.deleted_at IS NULL) AS nb_units,

  (SELECT COUNT(*) FROM projects
   WHERE client_id = 'cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd'
   AND legacy_imported = true AND deleted_at IS NULL) AS nb_projets_propria_legacy,

  (SELECT COUNT(*) FROM payments p
   JOIN projects pj ON pj.id = p.project_id
   WHERE pj.client_id = 'cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd'
     AND pj.legacy_imported = true) AS nb_payments_pollution;

-- Détail visuel : tous les biens et lots Hakim après pilote
SELECT
  '🏠 Détail biens Hakim' AS info,
  p.propria_internal_code,
  p.address,
  p.propria_managed_at IS NOT NULL AS en_propria,
  (SELECT STRING_AGG(u.code || ' (' || u.propria_base_price_per_night::text || ' MAD)', ' | ' ORDER BY u.order_index)
   FROM propria_units u WHERE u.property_id = p.id AND u.deleted_at IS NULL) AS lots
FROM properties p
JOIN projects pj ON pj.property_id = p.id
WHERE pj.client_id = 'cb19a7fd-b9ec-4c1c-9852-a5b36bfe18bd'
  AND p.deleted_at IS NULL AND pj.deleted_at IS NULL
ORDER BY p.propria_internal_code NULLS LAST;
