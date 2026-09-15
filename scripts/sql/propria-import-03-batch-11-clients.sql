-- ============================================================================
-- IMPORT PROPRIA — Batch 11 clients restants
-- ============================================================================
-- Stratégie (validée sur pilote Hakim) :
--   - Bien EXISTANT (property liée au projet existant) → UPDATE non-destructif
--     (COALESCE) + INSERT lots
--   - Bien NOUVEAU → INSERT property + INSERT projet PROPRIA legacy +
--     cleanup artefacts init_new_project + INSERT lots
--   - 1 client à créer (Paul Benneli)
--
-- 12 propriétaires, ~12 biens, ~30 lots.
-- Fix au passage : BEJ GUENI address (NULL post-pilote).
-- ============================================================================

DO $$
DECLARE
  v_client_id UUID;
  v_property_id UUID;
  v_project_id UUID;

  -- Helper var pour récupérer téléphones existants
  v_phone TEXT;
BEGIN

  -- ═════════════════════════════════════════════════════════════════════════
  -- 0. FIX BEJ GUENI — combler l'adresse (était NULL)
  -- ═════════════════════════════════════════════════════════════════════════
  UPDATE properties
  SET address = COALESCE(address, 'Rue Rahal Ben Ahmed, immeuble Al Hanae, 1er étage, numéro 9.')
  WHERE id = (
    SELECT property_id FROM projects WHERE code = 'boucheniata-hakim-bej-gueni'
    AND deleted_at IS NULL LIMIT 1
  );

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1. REDHA FOUDAD — bien existant (redha-foudad) + 2 lots FOUDAD
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := 'd6deaac6-8663-4e36-8cf4-1ea1095c6cf3';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'redha-foudad'
    AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Naoufal 1 Camp El GHOUL, Rue Lieutenant Lamyr, RDC, appartement 3.'),
    floor = COALESCE(floor, '0'), -- RDC = 0
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'FOUDAD'),
    propria_owner_name = COALESCE(propria_owner_name, 'Redha Foudad'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'foudadredha@gmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/PbotHjcpi51TNB6s5'),
    propria_apartment_door = COALESCE(propria_apartment_door, '3'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'ouvert_24_24'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_badge_building = COALESCE(propria_badge_building, '7559#'),
    propria_arrival_video_url = COALESCE(propria_arrival_video_url, 'https://drive.google.com/file/d/157t9U2KudJ1Txf5n-wQ1OWVX-hqP7gE8/view?usp=drive_link'),
    propria_water_contract = COALESCE(propria_water_contract, '1269002'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1269004'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27342573'),
    propria_camera_installed = true,
    propria_app_admin_access = true
  WHERE id = v_property_id;

  INSERT INTO propria_units (
    property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code,
    propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url,
    propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'FOUDAD 1', true, '3', 2, 1, true, '357890#',
     '1994', 3, 'HUAWEI-5G-Vky2', 'Jtu7qMmz',
     'https://fr.airbnb.com/rooms/1570977952234598328', 499.00,
     'https://drive.google.com/drive/folders/1vbbCSioBxGkPS4S063VNUvzJjOwZoMh9?usp=drive_link', true),
    (v_property_id, 2, 'FOUDAD 2', true, '3', 2, 1, true, '357890#',
     '1995', 3, 'HUAWEI-5G-Vky2', 'Jtu7qMmz',
     'https://fr.airbnb.com/rooms/1570978439382372541', 599.00,
     'https://drive.google.com/drive/folders/1CA69S3LHGxCg5ForxxJITyShjQ3LKJf3?usp=drive_link', true);

  RAISE NOTICE 'FOUDAD : 1 property updated + 2 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2. YASSINE EL BADAOUI — 2 NOUVEAUX biens (WARDA + BADAOUI AF)
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := 'e5b1a61a-69d0-4be8-8f8c-7fb56ab233f2';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;

  -- ─── 2a. WARDA ───────────────────────────────────────────────────────────
  INSERT INTO properties (
    name, address, type, floor,
    propria_managed_at, propria_internal_code,
    propria_owner_name, propria_owner_phone, propria_owner_email,
    propria_google_maps_url, propria_apartment_door,
    propria_commission_rate, propria_building_access_type,
    propria_access_admin, propria_badge_building,
    propria_arrival_video_url,
    propria_water_contract, propria_electricity_contract, propria_internet_contract,
    propria_camera_installed, propria_app_admin_access,
    propria_syndic_to_pay, propria_syndic_amount
  ) VALUES (
    'WARDA — Al Warda 7 (Yassine)', 'AL WARDA 7 APPT AU 1ERE ETAGE RUE MOSLEM AV ALLAL FASSI PREFECTURE DE MARRAKECH',
    'Appartement', '2', now(), 'WARDA',
    'Yassine El Badaoui', v_phone, 'elbadaoui.yassine@hotmail.com',
    'https://maps.app.goo.gl/KV9qajfj3QNd5ain7', '13',
    20.00, 'cle', 'Oui', '1994',
    'https://drive.google.com/file/d/14-r7V-TIf56nGN_xQt1TPpMBH7pNXvGn/view?usp=drive_link',
    '1269081', '1269079', '27473084',
    true, true, true, 150.00
  ) RETURNING id INTO v_property_id;

  INSERT INTO projects (client_id, property_id, current_phase, status, is_preparation, legacy_imported, activated_at)
    VALUES (v_client_id, v_property_id, 'mise_en_location', 'actif', false, true, now())
    RETURNING id INTO v_project_id;
  DELETE FROM payments WHERE project_id = v_project_id;
  DELETE FROM tasks WHERE project_id = v_project_id;
  DELETE FROM project_phases_history WHERE project_id = v_project_id;
  INSERT INTO project_phases_history (project_id, phase, started_at) VALUES (v_project_id, 'mise_en_location', now());

  INSERT INTO propria_units (
    property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url,
    propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'WARDA 1', true, '13', 2, 1, true, '7744770#', '*0001', 1,
     'Fibre_MarocTelecom-3708', 'VuF9d2pJac',
     'https://fr.airbnb.com/rooms/1604332603089252035', 449.00,
     'https://drive.google.com/drive/folders/1Aqhp-fWyIDKYIiA9c2zAIvifS66KEVNl?usp=drive_link', true),
    (v_property_id, 2, 'WARDA 2', true, '13', 2, 1, true, '7744770#', '*0002', 1,
     'Fibre_MarocTelecom-3708', 'VuF9d2pJac',
     'https://fr.airbnb.com/rooms/1604350557921064718', 449.00,
     'https://drive.google.com/drive/folders/19jQwKNH4kgq9jtRZxxafeLiSIoiYmTns?usp=drive_link', true),
    (v_property_id, 3, 'WARDA 3', true, '13', 2, 1, true, '7744770#', '*0003', 1,
     'Fibre_MarocTelecom-3708', 'VuF9d2pJac',
     'https://fr.airbnb.com/rooms/1604374355409781999', 449.00,
     'https://drive.google.com/drive/folders/1lzZfrO6frl_N-Uh85BZ9lnrDJDU3kWe4?usp=drive_link', true);

  RAISE NOTICE 'WARDA : 1 nouvelle property + 3 lots';

  -- ─── 2b. BADAOUI AF (Allal Fassi) ────────────────────────────────────────
  INSERT INTO properties (
    name, address, type, floor,
    propria_managed_at, propria_internal_code,
    propria_owner_name, propria_owner_phone, propria_owner_email,
    propria_google_maps_url, propria_apartment_door,
    propria_commission_rate, propria_building_access_type, propria_access_admin,
    propria_arrival_video_url,
    propria_internet_contract,
    propria_camera_installed, propria_app_admin_access
  ) VALUES (
    'BADAOUI AF — Av Allal Fassi (Yassine)',
    'Avenue Allal Fassi, complexe Dar el Hamra, immeuble mmD, 3ème étage, appartement 7.',
    'Appartement', '3', now(), 'BADAOUI AF',
    'Yassine El Badaoui', v_phone, 'elbadaoui.yassine@hotmail.com',
    'https://maps.app.goo.gl/RP5DZmFRx4FHka1K7?g_st=com.google.maps.preview.copy', '7',
    20.00, 'ouvert_24_24', 'Oui',
    'https://drive.google.com/file/d/1uIWuNHkhvV3AOOoaKztuHuIdhOKBu5mc/view?usp=drive_link',
    '27453246',
    true, true
  ) RETURNING id INTO v_property_id;

  INSERT INTO projects (client_id, property_id, current_phase, status, is_preparation, legacy_imported, activated_at)
    VALUES (v_client_id, v_property_id, 'mise_en_location', 'actif', false, true, now())
    RETURNING id INTO v_project_id;
  DELETE FROM payments WHERE project_id = v_project_id;
  DELETE FROM tasks WHERE project_id = v_project_id;
  DELETE FROM project_phases_history WHERE project_id = v_project_id;
  INSERT INTO project_phases_history (project_id, phase, started_at) VALUES (v_project_id, 'mise_en_location', now());

  INSERT INTO propria_units (
    property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url,
    propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'BADAOUI AF 1', true, '7', 2, 1, true, '782369#', '6661', 3,
     'HUAWEI-2.4G-eM5F', '4GJWcRFq',
     'https://fr.airbnb.com/rooms/1623009161605648566', 392.00,
     'https://drive.google.com/drive/folders/1YZlUkQBi9EFnGCVmjymHIAuTrYSXFrzr?usp=drive_link', true),
    (v_property_id, 2, 'BADAOUI AF 2', true, '7', 2, 1, true, '782369#', '6662', 1,
     'HUAWEI-2.4G-eM5F', '4GJWcRFq',
     'https://fr.airbnb.com/rooms/1623009453679275315', 370.00,
     'https://drive.google.com/drive/folders/1vCjX_3T215eD3BfzfxkCYo1yyUvpkB4Q?usp=drive_link', true),
    (v_property_id, 3, 'BADAOUI AF 3', true, '7', 2, 1, true, '782369#', '6663', 3,
     'HUAWEI-2.4G-eM5F', '4GJWcRFq',
     'https://fr.airbnb.com/rooms/1623160766360221576', 370.00,
     'https://drive.google.com/drive/folders/1BCJsCQVi9XfstWDoa9w5hHpW6S1lXr6s?usp=drive_link', true),
    (v_property_id, 4, 'BADAOUI AF 4', true, '7', 2, 1, true, '782369#', '6664', 3,
     'HUAWEI-2.4G-eM5F', '4GJWcRFq',
     'https://fr.airbnb.com/rooms/1623171396279106481', 370.00,
     'https://drive.google.com/drive/folders/1921z0gsHsoyiKyXUv2JTb5MO8Rdd-3D_?usp=drive_link', true);

  RAISE NOTICE 'BADAOUI AF : 1 nouvelle property + 4 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3. STEVEN BOUHRISS — bien existant (le-bouhris-steven) + 2 lots STEVEN
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := 'bb6a84d9-edcc-4625-8064-1a7ce386d618';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'le-bouhris-steven' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Résidence Poidomani, 58 Rue Tariq Bnou Ziad'),
    floor = COALESCE(floor, '1'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'STEVEN'),
    propria_owner_name = COALESCE(propria_owner_name, 'Steven Bouhriss'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'steven.lebourhis@gmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/Jd2Z35QKtHAFePZ97'),
    propria_apartment_door = COALESCE(propria_apartment_door, 'Porte Noire'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_badge_building = COALESCE(propria_badge_building, '1994'),
    propria_arrival_video_url = COALESCE(propria_arrival_video_url, 'https://drive.google.com/file/d/1SyPYwO7AJh08DXL2aH85Lm-FI1SlTZ6c/view?usp=drive_link'),
    propria_water_contract = COALESCE(propria_water_contract, '1278642'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1278638'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27426094'),
    propria_guardian_name = COALESCE(propria_guardian_name, 'Fadel'),
    propria_guardian_phone = COALESCE(propria_guardian_phone, '+212626113242'),
    propria_camera_installed = true,
    propria_app_admin_access = true,
    propria_info_sheet_to_send = true
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password,
    propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'STEVEN 1', true, 'Porte Noire', 2, 1, true, '258963#', '*0001', 3,
     'Fibre_MarocTelecom-8FDA-5GHz', 'WuutCsPBZ7',
     'https://fr.airbnb.com/rooms/1628200196046998499', 549.00,
     'https://drive.google.com/drive/folders/1k-S2ImigZ1arfVAI7b0JMlWdiL9n57S3?usp=drive_link', true),
    (v_property_id, 2, 'STEVEN 2', true, 'Porte Noire', 2, 1, true, '258963#', '*0002', 3,
     'Fibre_MarocTelecom-8FDA-5GHz', 'WuutCsPBZ7',
     'https://fr.airbnb.com/rooms/1625242782887199842', 470.00,
     'https://drive.google.com/drive/folders/1h3KvzQVCnFT4rgESBo68SNfcSuHvjDcc?usp=drive_link', true);

  RAISE NOTICE 'STEVEN : property updated + 2 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4. PATRICK LE SOURD — bien existant (fatima-rahmane-patrick-sourd) + 3 lots
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := 'b6cefce9-ce68-49aa-919a-d5590aef0c75';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'fatima-rahmane-patrick-sourd' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Résidence ZINEB ATLAS 45 APT 6 ETG 1 RUE MAURITANI'),
    floor = COALESCE(floor, '1'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'PATRICK'),
    propria_owner_name = COALESCE(propria_owner_name, 'Patrick le Sourd'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'patsourd@aol.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/4hMLPotHbq9hzhKC7'),
    propria_apartment_door = COALESCE(propria_apartment_door, '6'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'badge_asc_cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_badge_building = COALESCE(propria_badge_building, '1994'),
    propria_arrival_video_url = COALESCE(propria_arrival_video_url, 'https://drive.google.com/file/d/1TheQyuXjJK8tU7z3n4Igc8rRKP-wGAPx/view?usp=drive_link'),
    propria_water_contract = COALESCE(propria_water_contract, '1277703'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1277704'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27424705'),
    propria_camera_installed = true,
    propria_app_admin_access = true,
    propria_info_sheet_to_send = true
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'PATRICK 1', true, '6', 2, 1, true, '12369#', '*0001', 0,
     'HUAWEI-2.4G-9Ck8', 'MHMC4Ct6', 'https://fr.airbnb.com/rooms/1599884501544048145', 499.00,
     'https://drive.google.com/drive/folders/13pNS3SZ39iukEKcssWutIO-ZEnROZbIv?usp=drive_link', true),
    (v_property_id, 2, 'PATRICK 2', true, '6', 2, 1, true, '12369#', '*0002', 1,
     'HUAWEI-2.4G-9Ck8', 'MHMC4Ct6', 'https://fr.airbnb.com/rooms/1599961521637828105', 499.00,
     'https://drive.google.com/drive/folders/11OnvDzeBg9-nrg7TEpds0ZrtRvisvoQU?usp=drive_link', true),
    (v_property_id, 3, 'PATRICK 3', true, '6', 2, 1, true, '12369#', '*0003', 1,
     'HUAWEI-2.4G-9Ck8', 'MHMC4Ct6', 'https://fr.airbnb.com/rooms/1599910851909712289', 499.00,
     'https://drive.google.com/drive/folders/1l3rxz9Z6VN6U64puDxC2Ojf6sM4ZTe0f?usp=drive_link', true);

  RAISE NOTICE 'PATRICK : property updated + 3 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5. EL EULJ MAMOUN — bien existant (el-eulj-el-mamoun) + 3 lots MAMOUN
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := '72f898d7-b896-47da-b115-33f819315bd2';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'el-eulj-el-mamoun' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Résidence Mehdi 1, Camp El GHOUL, 3ème étage, appartement 15'),
    floor = COALESCE(floor, '3'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'MAMOUN'),
    propria_owner_name = COALESCE(propria_owner_name, 'El Eulj Mamoun'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'cafc.eleulj.elmamoun@gmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/rQ6VcB8hqkXpU9oi8'),
    propria_apartment_door = COALESCE(propria_apartment_door, '15'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_badge_building = COALESCE(propria_badge_building, '7770'),
    propria_arrival_video_url = COALESCE(propria_arrival_video_url, 'https://drive.google.com/file/d/17ovh5oJLcxk1C1KyNvD7k6zV5aOf_Zj5/view?usp=drive_link'),
    propria_water_contract = COALESCE(propria_water_contract, '1287541'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1287542'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27426121'),
    propria_camera_installed = true,
    propria_app_admin_access = true,
    propria_syndic_to_pay = true,
    propria_syndic_amount = COALESCE(propria_syndic_amount, 333.33)  -- 4000 MAD/an
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'MAMOUN 1', true, '15', 2, 1, true, '159870#', '2020', 3,
     'HUAWEI-5G', '5DHt6hmP', 'https://fr.airbnb.com/rooms/1573828747412029398', 549.00,
     'https://drive.google.com/drive/folders/1zUNwJ_OpmHb4qUdp6AEaChFKW0_OMd6W?usp=drive_link', true),
    (v_property_id, 2, 'MAMOUN 2', true, '15', 2, 1, true, '159870#', '2021', 3,
     'HUAWEI-5G', '5DHt6hmP', 'https://fr.airbnb.com/rooms/1573801134605668172', 499.00,
     'https://drive.google.com/drive/folders/1wNLz_O1ytQfxHAeWZ0NdQz31DDWsRezT?usp=drive_link', true),
    (v_property_id, 3, 'MAMOUN 3', true, '15', 2, 1, true, '159870#', '2022', 3,
     'HUAWEI-5G', '5DHt6hmP', 'https://fr.airbnb.com/rooms/1572377019221135047', 499.00,
     'https://drive.google.com/drive/folders/1Gj2XKVLQ5t5MsCYNQSk-BdTXj3Mj73bp?usp=drive_link', true);

  RAISE NOTICE 'MAMOUN : property updated + 3 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6. DUC NGUYEN — bien existant (duc-nguyen) + 2 lots DUC
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := '8dddfd4e-b547-402d-83c2-706dd51d1f13';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'duc-nguyen' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Rue Bata, 115 Résidence Majorella, appartement n°8, 3ème étage.'),
    floor = COALESCE(floor, '3'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'DUC'),
    propria_owner_name = COALESCE(propria_owner_name, 'Duc Nguyen'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'ducduy.n@gmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/dQ9ZgTkau6Mq35qX7'),
    propria_apartment_door = COALESCE(propria_apartment_door, '8'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'badge_asc_cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_water_contract = COALESCE(propria_water_contract, '1297535'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1297532'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27474146'),
    propria_camera_installed = true,
    propria_app_admin_access = true,
    propria_syndic_to_pay = true,
    propria_syndic_amount = COALESCE(propria_syndic_amount, 250.00)  -- 3000 MAD/an
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'DUC 1', true, '8', 2, 1, true, '6665755#', '*4000', 2,
     'HUAWEI-5G-APq4', 'YETk2TMc', 'https://fr.airbnb.com/rooms/1629589446548107726', 449.00,
     'https://drive.google.com/drive/folders/1EZgK27V78ZrcfzGNbViywPAv1rww6zYS?usp=drive_link', true),
    (v_property_id, 2, 'DUC 2', true, '8', 2, 1, true, '6665755#', '*5000', 2,
     'HUAWEI-5G-APq4', 'YETk2TMc', 'https://fr.airbnb.com/rooms/1629578409665020573', 449.00,
     'https://drive.google.com/drive/folders/1syWctbcfhYtmZfqt4A511VQbqcVXLJIq?usp=drive_link', true);

  RAISE NOTICE 'DUC : property updated + 2 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7. PAUL BENNELI — CRÉATION client + bien + projet + 2 lots
  -- ═════════════════════════════════════════════════════════════════════════
  INSERT INTO clients (full_name, email)
  VALUES ('Paul Benneli', 'paulbenelli1@gmail.com')
  RETURNING id INTO v_client_id;

  INSERT INTO properties (
    name, address, type, floor,
    propria_managed_at, propria_internal_code,
    propria_owner_name, propria_owner_email,
    propria_google_maps_url, propria_apartment_door,
    propria_commission_rate, propria_building_access_type, propria_access_admin,
    propria_arrival_video_url,
    propria_water_contract, propria_electricity_contract, propria_internet_contract,
    propria_camera_installed, propria_app_admin_access,
    propria_syndic_to_pay, propria_syndic_amount
  ) VALUES (
    'PAUL — Résidence Asbahani 3 (Benneli)',
    'Résidence Asbahani 3, n°12 Rue Ezzoubair Ben El Aoumam et Avenue Hassan II, Marrakech.',
    'Appartement', '2', now(), 'PAUL',
    'Paul Benneli', 'paulbenelli1@gmail.com',
    'https://maps.app.goo.gl/sxNBWFQ73neodeFz9', '6',
    20.00, 'ouvert_24_24', 'Oui',
    'https://drive.google.com/file/d/1EkY8nleDG9oRkIVzjoIxq9JEWe9sc1wY/view?usp=drive_link',
    '1302064', '1302060', '27475386',
    true, true, true, 200.00
  ) RETURNING id INTO v_property_id;

  INSERT INTO projects (client_id, property_id, current_phase, status, is_preparation, legacy_imported, activated_at)
    VALUES (v_client_id, v_property_id, 'mise_en_location', 'actif', false, true, now())
    RETURNING id INTO v_project_id;
  DELETE FROM payments WHERE project_id = v_project_id;
  DELETE FROM tasks WHERE project_id = v_project_id;
  DELETE FROM project_phases_history WHERE project_id = v_project_id;
  INSERT INTO project_phases_history (project_id, phase, started_at) VALUES (v_project_id, 'mise_en_location', now());

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'PAUL 1', true, '6', 2, 1, true, '141516#', '*0001', 0,
     'Fibre_MarocTelecom-2FA2', 'bW8UuG5HZy', 'https://fr.airbnb.com/rooms/1632648985602751094', 449.00,
     'https://drive.google.com/drive/folders/1cuQMSjPGCgvUpWsOPsjPOvL-5b3nuo8k?usp=drive_link', true),
    (v_property_id, 2, 'PAUL 2', true, '6', 2, 1, true, '141516#', '*0002', 0,
     'Fibre_MarocTelecom-2FA2', 'bW8UuG5HZy', 'https://fr.airbnb.com/rooms/1630332766585239455', 449.00,
     'https://drive.google.com/drive/folders/1PvVDP2h5GQMUYjZvxBhGbEoZEJeYzWK_?usp=drive_link', true);

  RAISE NOTICE 'PAUL BENNELI : client créé + property + 2 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8. CATHERINE EVERARD — bien existant (evrard-catherine) + 2 lots CATHERINE
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := '002a6440-4833-4bf1-b0d3-5494619e967d';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'evrard-catherine' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Résidence Les Orangers, Boulevard Mohamed Zerktouni, Marrakech'),
    floor = COALESCE(floor, '1'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'CATHERINE'),
    propria_owner_name = COALESCE(propria_owner_name, 'Catherine Everard'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'catherinevrard@hotmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/pMeho6ebK1yqgPiM8'),
    propria_apartment_door = COALESCE(propria_apartment_door, '1'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_badge_building = COALESCE(propria_badge_building, '1011'),
    propria_water_contract = COALESCE(propria_water_contract, '1298343'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1298342'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27481268'),
    propria_guardian_name = COALESCE(propria_guardian_name, 'Miloud'),
    propria_guardian_phone = COALESCE(propria_guardian_phone, '+212634069482'),
    propria_camera_installed = true,
    propria_app_admin_access = true,
    propria_syndic_to_pay = true,
    propria_syndic_amount = COALESCE(propria_syndic_amount, 200.00)
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'CATHERINE 1', true, '1', 2, 1, true, '102030#', '2',
     'HUAWEI-2.4G-D3tg', 'eXt6WG7h', 'https://fr.airbnb.com/rooms/1664595867165275158', 800.00,
     'https://drive.google.com/drive/folders/1PAPEmyLSPSpK_ZVxsWl33fXiI8sXWQTl?usp=drive_link', true),
    (v_property_id, 2, 'CATHERINE 2', true, '1', 2, 1, true, '102030#', '1',
     'HUAWEI-2.4G-D3tg', 'eXt6WG7h', 'https://fr.airbnb.com/rooms/1660817783387255170', 650.00,
     'https://drive.google.com/drive/folders/19TM_Jgn520xyrImT7CkF599yC1gEDaIN?usp=drive_link', true);

  RAISE NOTICE 'CATHERINE : property updated + 2 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9. KAMIL JOUNDY — bien existant (joundy-kamil) + 4 lots JOUNDY
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := '4a267ce7-7250-43a6-8ffd-cc889db5a8d8';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'joundy-kamil' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Avenue Yacoub El Mansour, résidence Jazoud, bâtiment B, appartement n°3, 1er étage'),
    floor = COALESCE(floor, '1'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'JOUNDY'),
    propria_owner_name = COALESCE(propria_owner_name, 'Kamil Joundy'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'kamil.joundy@gmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/tKjZcEwA99gaqn4d6?g_st=iw'),
    propria_apartment_door = COALESCE(propria_apartment_door, '3'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'digicode'),
    propria_access_admin = COALESCE(propria_access_admin, 'Oui'),
    propria_badge_building = COALESCE(propria_badge_building, '1718'),
    propria_arrival_video_url = COALESCE(propria_arrival_video_url, 'https://drive.google.com/file/d/1hiZH8totjGlOte2mGpZ-6lIyv8t6raXs/view?usp=drive_link'),
    propria_water_contract = COALESCE(propria_water_contract, '1237513'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1237511'),
    propria_camera_installed = true,
    propria_app_admin_access = true
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'JOUNDY 1', true, '3', 2, 1, true, '203040#', '1994',
     'Home 3', '2024@@2025', 'https://fr.airbnb.com/rooms/1355022671416908451', 399.00,
     'https://drive.google.com/drive/folders/1qCsp47-s4UOBJ_p5B2rZSg3l9FyDUUkE?usp=drive_link', true),
    (v_property_id, 2, 'JOUNDY 2', true, '3', 2, 1, true, '203040#', '1995',
     'Home 3', '2024@@2025', 'https://fr.airbnb.com/rooms/1354995062641879519', 599.00,
     'https://drive.google.com/drive/folders/1K7picJVcMjHWA7qKY_3odvRTYqDhGl-6?usp=drive_link', true),
    (v_property_id, 3, 'JOUNDY 3', true, '3', 2, 1, true, '203040#', '1996',
     'Home 3', '2024@@2025', 'https://fr.airbnb.com/rooms/1355051523507070977', 499.00,
     'https://drive.google.com/drive/folders/1_tFmrXFJ4Kot6rk9MbPjXoGRgwBUpOK8?usp=drive_link', true),
    (v_property_id, 4, 'JOUNDY 4', true, '3', 2, 1, true, '203040#', '1997',
     'Home 3', '2024@@2025', 'https://fr.airbnb.com/rooms/1355041190199756635', 549.00,
     'https://drive.google.com/drive/folders/1f7qzgdK4Xitl0E5Gdo4fJ-V5F_kqRroL?usp=drive_link', true);

  RAISE NOTICE 'JOUNDY : property updated + 4 lots';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10. PAUL FERRERA — pas de property (paul-serge-ferreira) → CRÉATION
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := '0d106d32-67be-4c1f-a7ca-c48d485fd1d3';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;

  -- Le projet existe (paul-serge-ferreira) mais sans property. On crée la
  -- property et on la lie au projet existant ? Ou on crée un nouveau projet
  -- PROPRIA legacy ? Pour la cohérence (1 projet PROPRIA par bien), on crée
  -- un nouveau projet et on laisse l'autre tel quel.

  INSERT INTO properties (
    name, address, type, floor,
    propria_managed_at, propria_internal_code,
    propria_owner_name, propria_owner_phone, propria_owner_email,
    propria_google_maps_url, propria_apartment_door,
    propria_commission_rate, propria_building_access_type, propria_access_admin,
    propria_arrival_video_url,
    propria_water_contract, propria_electricity_contract, propria_internet_contract,
    propria_camera_installed, propria_app_admin_access
  ) VALUES (
    'PATISSERIE KAWTAR — Rue Moulay Abdellah (Ferrera)',
    'Rue Moulay Abdellah, 1er étage, numéro 183 (porte en aluminium)',
    'Appartement', '1', now(), 'PATISSERIE KAWTAR',
    'Paul Ferrera', v_phone, 'souad.meziane@hotmail.com',
    'http://www.google.com/maps?q=31.643686,-8.008568', '183',
    20.00, 'ouvert_24_24', 'Non',
    'https://drive.google.com/file/d/1ZdqryD0PIW-D_JRaWdkzNAtaPjyi6aOh/view?usp=drive_link',
    '1319704', '1319705', '27349185',
    true, true
  ) RETURNING id INTO v_property_id;

  INSERT INTO projects (client_id, property_id, current_phase, status, is_preparation, legacy_imported, activated_at)
    VALUES (v_client_id, v_property_id, 'mise_en_location', 'actif', false, true, now())
    RETURNING id INTO v_project_id;
  DELETE FROM payments WHERE project_id = v_project_id;
  DELETE FROM tasks WHERE project_id = v_project_id;
  DELETE FROM project_phases_history WHERE project_id = v_project_id;
  INSERT INTO project_phases_history (project_id, phase, started_at) VALUES (v_project_id, 'mise_en_location', now());

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite,
    propria_wifi_ssid, propria_wifi_password, propria_airbnb_url, propria_base_price_per_night, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'PATISSERIE KAWTAR', true, '183', 2, 1, false, '145698#', NULL,
     'HUAWEI-5G-Pm7C', 'b7KKe7PD', 'https://fr.airbnb.com/rooms/1538649920741733146', 629.00,
     'https://drive.google.com/drive/folders/1Dnv-AphRvp-a7nDPV-ytXwZs59vjwi0T?usp=drive_link', true);

  RAISE NOTICE 'PATISSERIE KAWTAR (Ferrera) : property + projet + 1 lot';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11. YAMINA HAMOUCHE — bien existant (hamouche-yamina-achraf) + 2 lots YAMINA
  -- ═════════════════════════════════════════════════════════════════════════
  v_client_id := '0d13d9cd-85d7-4be1-9f3c-4f939d1af736';
  SELECT phone INTO v_phone FROM clients WHERE id = v_client_id;
  SELECT property_id INTO v_property_id FROM projects
    WHERE client_id = v_client_id AND code = 'hamouche-yamina-achraf' AND deleted_at IS NULL LIMIT 1;

  UPDATE properties SET
    address = COALESCE(address, 'Imm Atlassi 3 eme étage appart N 12, rue yougoslavie, Marrakech 40000'),
    floor = COALESCE(floor, '3'),
    propria_managed_at = COALESCE(propria_managed_at, now()),
    propria_internal_code = COALESCE(propria_internal_code, 'YAMINA'),
    propria_owner_name = COALESCE(propria_owner_name, 'Yamina Hamouche'),
    propria_owner_phone = COALESCE(propria_owner_phone, v_phone),
    propria_owner_email = COALESCE(propria_owner_email, 'hammoucheyamina@gmail.com'),
    propria_google_maps_url = COALESCE(propria_google_maps_url, 'https://maps.app.goo.gl/eG6J94eRrjBQqCYr9'),
    propria_apartment_door = COALESCE(propria_apartment_door, '12'),
    propria_commission_rate = COALESCE(propria_commission_rate, 20.00),
    propria_building_access_type = COALESCE(propria_building_access_type, 'cle'),
    propria_access_admin = COALESCE(propria_access_admin, 'Non'),
    propria_water_contract = COALESCE(propria_water_contract, '1297519'),
    propria_electricity_contract = COALESCE(propria_electricity_contract, '1297521'),
    propria_internet_contract = COALESCE(propria_internet_contract, '27717184'),
    propria_guardian_name = COALESCE(propria_guardian_name, 'Hassan'),
    propria_guardian_phone = COALESCE(propria_guardian_phone, '+212710074169'),
    propria_camera_installed = false,
    propria_app_admin_access = false,
    propria_info_sheet_to_send = true
  WHERE id = v_property_id;

  INSERT INTO propria_units (property_id, order_index, code, code_locked,
    propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres,
    propria_smart_lock, propria_lock_code, propria_key_box_suite, propria_nb_keys,
    propria_wifi_ssid, propria_wifi_password, propria_drive_photos_url, propria_app_admin_access
  ) VALUES
    (v_property_id, 1, 'YAMINA 1', true, '12', 2, 1, true, '114477#', '1', 3,
     'HUAWEI-2.4G-d2Tt', 'KUbJ2Z3q',
     'https://drive.google.com/drive/folders/1dKs9lDC83k8TIohJLEdWA92fxlCaC3eg?usp=drive_link', false),
    (v_property_id, 2, 'YAMINA 2', true, '12', 2, 1, true, '114477#', '2', 2,
     'HUAWEI-2.4G-d2Tt', 'KUbJ2Z3q',
     'https://drive.google.com/drive/folders/1sNZj8fhKQxIgY-oWnqrjdkIyV6oxu-VL?usp=drive_link', false);

  RAISE NOTICE 'YAMINA : property updated + 2 lots';

  RAISE NOTICE 'BATCH 11 clients TERMINÉ avec succès.';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Vérifications globales
-- ═════════════════════════════════════════════════════════════════════════════
SELECT
  '📊 Récap global PROPRIA' AS info,
  (SELECT COUNT(*) FROM properties WHERE propria_managed_at IS NOT NULL AND deleted_at IS NULL) AS nb_properties_propria,
  (SELECT COUNT(*) FROM propria_units WHERE deleted_at IS NULL) AS nb_units_total,
  (SELECT COUNT(*) FROM projects WHERE legacy_imported = true AND deleted_at IS NULL) AS nb_projets_legacy,
  (SELECT COUNT(*) FROM payments p
   JOIN projects pj ON pj.id = p.project_id
   WHERE pj.legacy_imported = true) AS nb_payments_pollution,
  (SELECT COUNT(*) FROM clients WHERE email = 'paulbenelli1@gmail.com') AS paul_benneli_existe;

-- Vue par propriétaire
SELECT
  c.full_name,
  c.email,
  COUNT(DISTINCT pr.id) AS nb_biens_propria,
  COUNT(DISTINCT u.id) AS nb_lots_total,
  STRING_AGG(DISTINCT pr.propria_internal_code, ' | ' ORDER BY pr.propria_internal_code) AS biens
FROM clients c
JOIN projects p ON p.client_id = c.id AND p.deleted_at IS NULL
JOIN properties pr ON pr.id = p.property_id AND pr.deleted_at IS NULL AND pr.propria_managed_at IS NOT NULL
LEFT JOIN propria_units u ON u.property_id = pr.id AND u.deleted_at IS NULL
WHERE c.email IN (
  'boucheniata.hakim@gmail.com', 'foudadredha@gmail.com', 'elbadaoui.yassine@hotmail.com',
  'steven.lebourhis@gmail.com', 'patsourd@aol.com', 'cafc.eleulj.elmamoun@gmail.com',
  'ducduy.n@gmail.com', 'paulbenelli1@gmail.com', 'catherinevrard@hotmail.com',
  'kamil.joundy@gmail.com', 'souad.meziane@hotmail.com', 'hammoucheyamina@gmail.com'
)
GROUP BY c.id, c.full_name, c.email
ORDER BY c.full_name;
