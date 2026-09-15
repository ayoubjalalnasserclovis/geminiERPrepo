-- ============================================================================
-- Corrections post-refonte propria_units (2026-05-30)
-- ============================================================================
-- Trois corrections couplées :
--
--   1. Les contrats utilités (eau / élec / internet) vivaient sur projects
--      (water_contract_number etc) côté UI, mais le widget de complétude
--      lisait properties.propria_*_contract. Cassure d'aiguillage.
--      → On migre la source de vérité vers properties.propria_*_contract
--        (le contrat est un attribut du bien physique, pas du dossier client).
--      → On copie les données existantes depuis projects vers properties.
--      → On met à jour la RPC advance_project_phase pour qu'elle lise
--        depuis properties.
--      → On marque projects.*_contract_number DEPRECATED (cleanup +30j).
--
--   2. Les colonnes wifi/lock_code/smart_lock avaient été déplacées vers
--      propria_units par la migration précédente, mais elles sont en réalité
--      partagées par toutes les suites d'un même bien (1 box WiFi, 1 serrure
--      électronique principale). Aucun code TS ne les a basculées, elles
--      vivent toujours sur properties côté app.
--      → On annule le déplacement : properties reste source de vérité,
--        propria_units.propria_wifi_ssid/wifi_password/lock_code/smart_lock
--        deviennent DEPRECATED.
--
--   3. propria_key_box_home reste sur propria_units (1 boîte par suite avec
--      son propre code, utilisée par voyageurs et femmes de ménage) mais le
--      nom est trompeur ("home" suggère le logement principal).
--      → Renommée en propria_key_box_suite pour clarté.
--
-- IDEMPOTENT — toutes les opérations sont rejouables sans effet de bord.
-- AUCUN DROP — cleanup différé à +30 jours dans une migration séparée.
-- ============================================================================

-- ─── 1. Contrats utilités : copie projects.*_contract_number → properties ──
-- Seulement pour les projets qui ont un property_id ET une valeur source
-- non vide ET dont la cible est vide (pour ne pas écraser une valeur déjà
-- saisie côté bien).

UPDATE properties p
SET propria_water_contract = pr.water_contract_number,
    updated_at = now()
FROM projects pr
WHERE pr.property_id = p.id
  AND pr.water_contract_number IS NOT NULL
  AND length(trim(pr.water_contract_number)) > 0
  AND (p.propria_water_contract IS NULL OR length(trim(p.propria_water_contract)) = 0);

UPDATE properties p
SET propria_electricity_contract = pr.electricity_contract_number,
    updated_at = now()
FROM projects pr
WHERE pr.property_id = p.id
  AND pr.electricity_contract_number IS NOT NULL
  AND length(trim(pr.electricity_contract_number)) > 0
  AND (p.propria_electricity_contract IS NULL OR length(trim(p.propria_electricity_contract)) = 0);

UPDATE properties p
SET propria_internet_contract = pr.internet_contract_number,
    updated_at = now()
FROM projects pr
WHERE pr.property_id = p.id
  AND pr.internet_contract_number IS NOT NULL
  AND length(trim(pr.internet_contract_number)) > 0
  AND (p.propria_internet_contract IS NULL OR length(trim(p.propria_internet_contract)) = 0);

-- ─── 2. RPC advance_project_phase : lit désormais depuis properties ────────
-- On reprend la définition complète de 20260521003200_document_gates_extended,
-- en remplaçant uniquement les 2 vérifications de contrats numéro (eau + élec)
-- pour qu'elles regardent properties.propria_*_contract via le bien lié.

CREATE OR REPLACE FUNCTION advance_project_phase(
  p_project_id UUID,
  p_new_phase project_phase
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project projects;
  v_property properties;
  v_blocking_count INTEGER;
  v_user_id UUID := auth.uid();
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable: %', p_project_id;
  END IF;

  IF NOT (
    (v_project.current_phase = 'onboarding'       AND p_new_phase = 'sourcing') OR
    (v_project.current_phase = 'sourcing'         AND p_new_phase = 'design')   OR
    (v_project.current_phase = 'design'           AND p_new_phase = 'travaux')  OR
    (v_project.current_phase = 'travaux'          AND p_new_phase = 'livraison') OR
    (v_project.current_phase = 'livraison'        AND p_new_phase = 'mise_en_location') OR
    (v_project.current_phase = 'mise_en_location' AND p_new_phase = 'termine')
  ) THEN
    RAISE EXCEPTION 'Transition non autorisée: % → %', v_project.current_phase, p_new_phase;
  END IF;

  IF p_new_phase IN ('design','travaux','livraison','mise_en_location','termine') THEN
    IF v_project.property_id IS NULL THEN
      RAISE EXCEPTION 'Aucun bien n''est validé pour ce projet. Acceptez d''abord une proposition.';
    END IF;
    IF v_project.compromis_date IS NULL THEN
      RAISE EXCEPTION 'Date de signature du compromis manquante (requise pour Design et au-delà).';
    END IF;
  END IF;

  IF p_new_phase IN ('travaux','livraison','mise_en_location','termine') THEN
    IF v_project.acte_authentique_date IS NULL THEN
      RAISE EXCEPTION 'Date de signature de l''acte authentique manquante.';
    END IF;
  END IF;

  IF p_new_phase IN ('livraison','mise_en_location','termine') THEN
    IF v_project.travaux_start_date IS NULL THEN
      RAISE EXCEPTION 'Date de lancement de chantier manquante.';
    END IF;
    IF v_project.travaux_end_date IS NULL THEN
      RAISE EXCEPTION 'Date de livraison du chantier (fin travaux) manquante.';
    END IF;
  END IF;

  IF p_new_phase IN ('mise_en_location','termine') THEN
    IF v_project.livraison_date IS NULL THEN
      RAISE EXCEPTION 'Date de remise des clés au client manquante.';
    END IF;
  END IF;

  IF p_new_phase = 'travaux' THEN
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'compromis' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : compromis de vente (à uploader dans Documents).';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'plans_3d' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : plans 3D (dossier architecture).';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'lots_techniques' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : lots techniques (dossier architecture).';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'shopping_list' AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Document manquant : shopping list (dossier architecture).';
    END IF;
  END IF;

  IF p_new_phase = 'mise_en_location' THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'titre_foncier' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : titre foncier.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'autorisation_travaux' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : autorisation de travaux.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_eau' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat eau.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_electricite' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat électricité.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND type = 'contrat_assurance' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Document manquant : contrat d''assurance.';
    END IF;

    -- Numéros de contrats : on lit désormais depuis properties via le bien lié
    SELECT * INTO v_property FROM properties WHERE id = v_project.property_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bien introuvable pour ce projet.';
    END IF;
    IF v_property.propria_water_contract IS NULL OR length(trim(v_property.propria_water_contract)) = 0 THEN
      RAISE EXCEPTION 'Numéro de contrat eau manquant (carte Infrastructure & accès du bien).';
    END IF;
    IF v_property.propria_electricity_contract IS NULL OR length(trim(v_property.propria_electricity_contract)) = 0 THEN
      RAISE EXCEPTION 'Numéro de contrat électricité manquant (carte Infrastructure & accès du bien).';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_blocking_count
    FROM tasks
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND is_blocking = true
      AND status <> 'done';

  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Tâches bloquantes ouvertes (%) sur la phase %', v_blocking_count, v_project.current_phase;
  END IF;

  UPDATE project_phases_history
    SET completed_at = now(), completed_by = v_user_id
    WHERE project_id = p_project_id
      AND phase = v_project.current_phase
      AND completed_at IS NULL;

  UPDATE projects
    SET current_phase = p_new_phase, updated_at = now()
    WHERE id = p_project_id;

  INSERT INTO project_phases_history (project_id, phase, started_at)
    VALUES (p_project_id, p_new_phase, now());

  INSERT INTO tasks (project_id, template_id, phase, title, description, assigned_to, is_blocking, is_auto_generated, priority)
    SELECT p_project_id, t.id, t.phase, t.title, t.description,
      (SELECT id FROM profiles WHERE role = t.default_assigned_role AND is_active = true LIMIT 1),
      t.is_blocking, true, 'normal'
    FROM task_templates t
    WHERE t.phase = p_new_phase AND t.is_active = true
    ORDER BY t.order_index;

  IF p_new_phase = 'sourcing' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_compromis', 3800, 'sourcing', CURRENT_DATE + 30);
  ELSIF p_new_phase = 'design' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_3d', 3800, 'design', CURRENT_DATE + 14);
  ELSIF p_new_phase = 'travaux' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_chantier', 4200, 'travaux', CURRENT_DATE);
  ELSIF p_new_phase = 'livraison' THEN
    INSERT INTO payments (project_id, type, amount_expected, due_at_phase, due_date)
      VALUES (p_project_id, 'honoraires_livraison', 4200, 'livraison', CURRENT_DATE);
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_phase', p_new_phase);
END;
$$;

-- ─── 3. Marquage DEPRECATED des colonnes contrats sur projects ─────────────
COMMENT ON COLUMN projects.water_contract_number IS
  'DEPRECATED — migré vers properties.propria_water_contract. Cleanup prévu à +30 jours. Lire/écrire properties pour les nouveaux flux.';
COMMENT ON COLUMN projects.electricity_contract_number IS
  'DEPRECATED — migré vers properties.propria_electricity_contract. Cleanup prévu à +30 jours.';

-- internet_contract_number a été ajoutée par 20260521003300_internet_contract.sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'internet_contract_number'
  ) THEN
    COMMENT ON COLUMN projects.internet_contract_number IS
      'DEPRECATED — migré vers properties.propria_internet_contract. Cleanup prévu à +30 jours.';
  END IF;
END$$;

-- ─── 4. Annulation du déplacement wifi/lock/smart_lock ─────────────────────
-- properties reste la source de vérité. Les jumelles sur propria_units
-- créées par la migration précédente deviennent DEPRECATED.

COMMENT ON COLUMN properties.propria_wifi_ssid IS
  'SSID WiFi du bien (1 box, 1 réseau partagé entre toutes les suites). Source de vérité.';
COMMENT ON COLUMN properties.propria_wifi_password IS
  'Mot de passe WiFi du bien (1 box, 1 réseau partagé). Source de vérité.';
COMMENT ON COLUMN properties.propria_lock_code IS
  'Code serrure de la porte principale du logement (partagé entre suites). Source de vérité.';
COMMENT ON COLUMN properties.propria_smart_lock IS
  'Serrure électronique sur la porte principale (booléen). Source de vérité.';

COMMENT ON COLUMN propria_units.propria_wifi_ssid IS
  'DEPRECATED — WiFi est un attribut du bien (1 box partagée). Lire properties.propria_wifi_ssid. Cleanup +30 jours.';
COMMENT ON COLUMN propria_units.propria_wifi_password IS
  'DEPRECATED — WiFi est un attribut du bien (1 box partagée). Lire properties.propria_wifi_password. Cleanup +30 jours.';
COMMENT ON COLUMN propria_units.propria_lock_code IS
  'DEPRECATED — Serrure principale est un attribut du bien (porte partagée). Lire properties.propria_lock_code. Cleanup +30 jours.';
COMMENT ON COLUMN propria_units.propria_smart_lock IS
  'DEPRECATED — Serrure principale est un attribut du bien (porte partagée). Lire properties.propria_smart_lock. Cleanup +30 jours.';

-- ─── 5. Renommage propria_key_box_home → propria_key_box_suite ─────────────
-- 1 boîte à clés par suite avec son propre code. Le nom "home" était trompeur.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'propria_units' AND column_name = 'propria_key_box_home'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'propria_units' AND column_name = 'propria_key_box_suite'
  ) THEN
    ALTER TABLE propria_units RENAME COLUMN propria_key_box_home TO propria_key_box_suite;
  END IF;
END$$;

COMMENT ON COLUMN propria_units.propria_key_box_suite IS
  'Boîte à clés de la suite avec son code d''accès. Format libre (ex "rouge, à droite de la porte, code 1234"). Utilisé par voyageurs et femmes de ménage.';

-- properties.propria_key_box_home reste DEPRECATED (jamais utilisée puisque
-- ce concept est par-suite, pas par-bien)

-- ============================================================================
-- État cible :
--   - properties.propria_water_contract / propria_electricity_contract /
--     propria_internet_contract sont la source de vérité (donnée copiée).
--   - properties.propria_wifi_ssid / wifi_password / lock_code / smart_lock
--     restent source de vérité (le déplacement vers propria_units est annulé).
--   - propria_units.propria_wifi_ssid / wifi_password / lock_code / smart_lock
--     sont DEPRECATED (cleanup +30j).
--   - projects.water_contract_number / electricity_contract_number /
--     internet_contract_number sont DEPRECATED (cleanup +30j).
--   - propria_units.propria_key_box_home renommé en propria_key_box_suite.
--   - RPC advance_project_phase lit les contrats depuis properties.
-- ============================================================================
