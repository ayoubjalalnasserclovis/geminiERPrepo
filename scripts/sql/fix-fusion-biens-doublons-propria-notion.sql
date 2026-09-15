-- ============================================================================
-- FIX FUSION — Biens doublons PROPRIA (créés cette nuit) ↔ Biens Notion
-- ============================================================================
-- Décisions Othmane :
--   1. Yassine WARDA → fusion vers 174M2 Majorelle (Notion, 150k€)
--   2. Yassine BADAOUI AF → fusion vers 134m2 Al fassi (Notion, 155k€)
--   3. Paul Ferrera Patisserie Kawtar → rattacher bien PROPRIA au projet Notion
--   4. Hakim BEJ GUENI → copier prix de l'orphelin "134 M2 BEJGUENI"
--                       (2 400 000 MAD = 240 000 €)
--
-- Stratégie : transaction unique + snapshot data_fix_log + soft-delete
-- (pas de hard DELETE pour permettre rollback).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS data_fix_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_name TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by UUID REFERENCES profiles(id)
);

DO $$
DECLARE
  v_already_applied INT;
  -- Yassine
  v_warda_propria UUID := '3cc9a16f-bd4b-4705-bb74-d3963a89aae6';
  v_warda_notion  UUID := '2bfcfe5b-0ab3-4204-acab-750498b1a652';
  v_badaoui_propria UUID := '8fd1ec1c-d50f-47c5-89b1-ca41d3e6322d';
  v_badaoui_notion  UUID := '15796e18-9758-46e9-8821-7c61b566c974';
  -- Paul Ferrera
  v_kawtar_propria UUID := '5161e67d-9e72-4433-85f1-63238d937e6c';
  -- Hakim BEJ GUENI
  v_bejgueni_orphelin UUID := 'aae98e96-bd1f-42c7-9a17-8d0eab9bad6d';
  v_bejgueni_propria  UUID := '7d797b1e-9ca3-42ff-8034-c65f9d35347c';
  -- Projets
  v_proj_warda_propria UUID := 'b258a1a6-d0bb-46e4-b3eb-eccc7de07a6f';
  v_proj_badaoui_propria UUID := '6cfdaf15-dda4-4157-b241-db75d722ff90';
  v_proj_kawtar_propria UUID := '54a73acd-3899-4ad5-bda9-1bba6e9c8cff';
  v_proj_majorelle_notion UUID;
  v_proj_majorelle2_notion UUID;
  v_proj_ferreira_notion UUID;
BEGIN
  -- Idempotence
  SELECT COUNT(*) INTO v_already_applied FROM data_fix_log
    WHERE fix_name = 'fusion-doublons-notion-propria-2026-05-30';
  IF v_already_applied > 0 THEN
    RAISE NOTICE 'Fix déjà appliqué. Skip.';
    RETURN;
  END IF;

  -- Récupérer les projets Notion
  SELECT id INTO v_proj_majorelle_notion FROM projects
    WHERE code = 'el-badaoui-yassine-majorelle' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_proj_majorelle2_notion FROM projects
    WHERE code = 'el-badaoui-yassine-majorelle-2' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_proj_ferreira_notion FROM projects
    WHERE code = 'paul-serge-ferreira' AND deleted_at IS NULL LIMIT 1;

  -- Snapshot AVANT modification (pour rollback)
  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'fusion-doublons-notion-propria-2026-05-30', 'properties', p.id::text, to_jsonb(p)
  FROM properties p WHERE p.id IN (
    v_warda_propria, v_warda_notion, v_badaoui_propria, v_badaoui_notion,
    v_kawtar_propria, v_bejgueni_orphelin, v_bejgueni_propria
  );

  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'fusion-doublons-notion-propria-2026-05-30', 'projects', p.id::text, to_jsonb(p)
  FROM projects p WHERE p.id IN (
    v_proj_warda_propria, v_proj_badaoui_propria, v_proj_kawtar_propria,
    v_proj_majorelle_notion, v_proj_majorelle2_notion, v_proj_ferreira_notion
  );

  INSERT INTO data_fix_log (fix_name, entity, entity_id, snapshot)
  SELECT 'fusion-doublons-notion-propria-2026-05-30', 'propria_units', u.id::text, to_jsonb(u)
  FROM propria_units u WHERE u.property_id IN (v_warda_propria, v_badaoui_propria, v_kawtar_propria);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1. YASSINE WARDA : fusion bien PROPRIA → bien Notion 174M2 Majorelle
  -- ═════════════════════════════════════════════════════════════════════════
  -- Copier les colonnes PROPRIA du bien créé cette nuit vers le bien Notion
  UPDATE properties t SET
    name = COALESCE(t.name, s.name),
    address = COALESCE(t.address, s.address),
    propria_managed_at = COALESCE(t.propria_managed_at, s.propria_managed_at),
    propria_internal_code = COALESCE(t.propria_internal_code, s.propria_internal_code),
    propria_owner_name = COALESCE(t.propria_owner_name, s.propria_owner_name),
    propria_owner_phone = COALESCE(t.propria_owner_phone, s.propria_owner_phone),
    propria_owner_email = COALESCE(t.propria_owner_email, s.propria_owner_email),
    propria_google_maps_url = COALESCE(t.propria_google_maps_url, s.propria_google_maps_url),
    propria_apartment_door = COALESCE(t.propria_apartment_door, s.propria_apartment_door),
    propria_commission_rate = COALESCE(t.propria_commission_rate, s.propria_commission_rate),
    propria_building_access_type = COALESCE(t.propria_building_access_type, s.propria_building_access_type),
    propria_access_admin = COALESCE(t.propria_access_admin, s.propria_access_admin),
    propria_badge_building = COALESCE(t.propria_badge_building, s.propria_badge_building),
    propria_arrival_video_url = COALESCE(t.propria_arrival_video_url, s.propria_arrival_video_url),
    propria_water_contract = COALESCE(t.propria_water_contract, s.propria_water_contract),
    propria_electricity_contract = COALESCE(t.propria_electricity_contract, s.propria_electricity_contract),
    propria_internet_contract = COALESCE(t.propria_internet_contract, s.propria_internet_contract),
    propria_camera_installed = GREATEST(t.propria_camera_installed::int, s.propria_camera_installed::int)::boolean,
    propria_app_admin_access = GREATEST(t.propria_app_admin_access::int, s.propria_app_admin_access::int)::boolean,
    propria_syndic_to_pay = GREATEST(t.propria_syndic_to_pay::int, s.propria_syndic_to_pay::int)::boolean,
    propria_syndic_amount = COALESCE(t.propria_syndic_amount, s.propria_syndic_amount),
    updated_at = now()
  FROM properties s
  WHERE t.id = v_warda_notion AND s.id = v_warda_propria;

  -- Déplacer les propria_units
  UPDATE propria_units SET property_id = v_warda_notion
    WHERE property_id = v_warda_propria;

  -- Libérer le code en renommant + soft-delete le projet PROPRIA AVANT renommage Notion
  ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename;
  UPDATE projects SET
    code = code || '_obsolete_' || extract(epoch from now())::text,
    deleted_at = now()
    WHERE id = v_proj_warda_propria;

  -- Maintenant le code est libre, on peut renommer le projet Notion
  UPDATE projects SET code = 'el-badaoui-yassine-warda', updated_at = now()
    WHERE id = v_proj_majorelle_notion;
  ALTER TABLE clients ENABLE TRIGGER clients_propagate_rename;

  -- Soft-delete le bien PROPRIA
  UPDATE properties SET deleted_at = now() WHERE id = v_warda_propria;

  RAISE NOTICE 'WARDA fusionné.';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2. YASSINE BADAOUI AF : fusion bien PROPRIA → bien Notion 134m2 Al fassi
  -- ═════════════════════════════════════════════════════════════════════════
  UPDATE properties t SET
    name = COALESCE(t.name, s.name),
    address = COALESCE(t.address, s.address),
    propria_managed_at = COALESCE(t.propria_managed_at, s.propria_managed_at),
    propria_internal_code = COALESCE(t.propria_internal_code, s.propria_internal_code),
    propria_owner_name = COALESCE(t.propria_owner_name, s.propria_owner_name),
    propria_owner_phone = COALESCE(t.propria_owner_phone, s.propria_owner_phone),
    propria_owner_email = COALESCE(t.propria_owner_email, s.propria_owner_email),
    propria_google_maps_url = COALESCE(t.propria_google_maps_url, s.propria_google_maps_url),
    propria_apartment_door = COALESCE(t.propria_apartment_door, s.propria_apartment_door),
    propria_commission_rate = COALESCE(t.propria_commission_rate, s.propria_commission_rate),
    propria_building_access_type = COALESCE(t.propria_building_access_type, s.propria_building_access_type),
    propria_access_admin = COALESCE(t.propria_access_admin, s.propria_access_admin),
    propria_arrival_video_url = COALESCE(t.propria_arrival_video_url, s.propria_arrival_video_url),
    propria_internet_contract = COALESCE(t.propria_internet_contract, s.propria_internet_contract),
    propria_camera_installed = GREATEST(t.propria_camera_installed::int, s.propria_camera_installed::int)::boolean,
    propria_app_admin_access = GREATEST(t.propria_app_admin_access::int, s.propria_app_admin_access::int)::boolean,
    updated_at = now()
  FROM properties s
  WHERE t.id = v_badaoui_notion AND s.id = v_badaoui_propria;

  UPDATE propria_units SET property_id = v_badaoui_notion
    WHERE property_id = v_badaoui_propria;

  ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename;
  UPDATE projects SET
    code = code || '_obsolete_' || extract(epoch from now())::text,
    deleted_at = now()
    WHERE id = v_proj_badaoui_propria;

  UPDATE projects SET code = 'el-badaoui-yassine-badaoui-af', updated_at = now()
    WHERE id = v_proj_majorelle2_notion;
  ALTER TABLE clients ENABLE TRIGGER clients_propagate_rename;

  UPDATE properties SET deleted_at = now() WHERE id = v_badaoui_propria;

  RAISE NOTICE 'BADAOUI AF fusionné.';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3. PAUL FERRERA : rattacher bien PROPRIA au projet Notion existant
  -- ═════════════════════════════════════════════════════════════════════════
  -- Libérer le code en soft-deleting le projet PROPRIA AVANT renommage
  ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename;
  UPDATE projects SET
    code = code || '_obsolete_' || extract(epoch from now())::text,
    deleted_at = now()
    WHERE id = v_proj_kawtar_propria;

  -- Maintenant on peut renommer + rattacher le bien PROPRIA au projet Notion
  UPDATE projects SET
    property_id = v_kawtar_propria,
    code = 'paul-serge-ferreira-patisserie-kawtar',
    updated_at = now()
  WHERE id = v_proj_ferreira_notion;
  ALTER TABLE clients ENABLE TRIGGER clients_propagate_rename;

  RAISE NOTICE 'PATISSERIE KAWTAR rattachée au projet Notion.';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4. HAKIM BEJ GUENI : copier prix de l'orphelin
  -- ═════════════════════════════════════════════════════════════════════════
  -- L'orphelin a un prix en MAD (2 400 000). Conversion taux fixe 1 EUR = 10 MAD.
  -- On copie 240 000 EUR sur le bien PROPRIA.
  UPDATE properties SET
    price = 240000.00,
    updated_at = now()
  WHERE id = v_bejgueni_propria AND price IS NULL;

  -- Soft-delete l'orphelin
  UPDATE properties SET deleted_at = now() WHERE id = v_bejgueni_orphelin;

  RAISE NOTICE 'BEJ GUENI prix copié (240 000 €), orphelin supprimé.';

  RAISE NOTICE '✅ Fix fusion terminé : Yassine x2 + Paul Ferrera + Hakim BEJ GUENI';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Vérifications post-fix
-- ═════════════════════════════════════════════════════════════════════════════
SELECT
  '✅ Biens PROPRIA après fusion' AS section,
  c.full_name AS proprietaire,
  p.name AS bien,
  p.price AS prix,
  pr.code AS projet_code,
  pr.compromis_date,
  pr.livraison_date
FROM properties p
JOIN projects pr ON pr.property_id = p.id AND pr.deleted_at IS NULL
JOIN clients c ON c.id = pr.client_id
WHERE p.propria_managed_at IS NOT NULL
  AND p.deleted_at IS NULL
ORDER BY c.full_name, p.propria_internal_code NULLS LAST;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (à décommenter UNIQUEMENT si erreur)
-- ═════════════════════════════════════════════════════════════════════════════
/*
BEGIN;
ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename;

UPDATE properties p
SET name = (l.snapshot->>'name'),
    address = (l.snapshot->>'address'),
    price = NULLIF((l.snapshot->>'price'), '')::numeric,
    deleted_at = NULLIF((l.snapshot->>'deleted_at'), '')::timestamptz,
    propria_managed_at = NULLIF((l.snapshot->>'propria_managed_at'), '')::timestamptz,
    propria_internal_code = (l.snapshot->>'propria_internal_code'),
    propria_owner_name = (l.snapshot->>'propria_owner_name'),
    propria_owner_phone = (l.snapshot->>'propria_owner_phone'),
    propria_owner_email = (l.snapshot->>'propria_owner_email')
FROM data_fix_log l
WHERE l.entity = 'properties' AND l.entity_id = p.id::text
  AND l.fix_name = 'fusion-doublons-notion-propria-2026-05-30';

UPDATE projects pr
SET code = (l.snapshot->>'code'),
    property_id = NULLIF((l.snapshot->>'property_id'), '')::uuid,
    deleted_at = NULLIF((l.snapshot->>'deleted_at'), '')::timestamptz
FROM data_fix_log l
WHERE l.entity = 'projects' AND l.entity_id = pr.id::text
  AND l.fix_name = 'fusion-doublons-notion-propria-2026-05-30';

UPDATE propria_units u
SET property_id = ((l.snapshot->>'property_id'))::uuid
FROM data_fix_log l
WHERE l.entity = 'propria_units' AND l.entity_id = u.id::text
  AND l.fix_name = 'fusion-doublons-notion-propria-2026-05-30';

ALTER TABLE clients ENABLE TRIGGER clients_propagate_rename;
DELETE FROM data_fix_log WHERE fix_name = 'fusion-doublons-notion-propria-2026-05-30';
COMMIT;
*/
