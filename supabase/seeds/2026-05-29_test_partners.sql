-- ============================================================================
-- SEED de données de TEST — 3 partenaires + 6 agents
-- À exécuter dans le SQL editor Supabase, pas en migration versionnée.
-- ============================================================================
-- Permet de débloquer la création d'un bien quand on n'a pas encore de vrais
-- partenaires ni agents : on bascule sur "Sourcé via partenaire" dans le
-- formulaire, on sélectionne un de ces partenaires fictifs, on continue.
--
-- IDEMPOTENT : marqueur "seed_test_2026_05_29" dans `notes` empêche les
-- doublons à la ré-exécution.
--
-- CLEANUP : voir bloc en fin de fichier pour tout supprimer en 1 commande.
-- ============================================================================

DO $$
DECLARE
  v_seed_marker TEXT := 'seed_test_2026_05_29';
  v_partner_casa UUID;
  v_partner_marrakech UUID;
  v_partner_rabat UUID;
BEGIN
  -- ─── 3 PARTENAIRES ───────────────────────────────────────────────────────

  IF NOT EXISTS (SELECT 1 FROM partners WHERE notes LIKE '%' || v_seed_marker || '%' AND agency_name LIKE '%Atlas Realty%') THEN
    INSERT INTO partners (
      agency_name, contact_name, phone, email, address,
      quartiers_covered, status, contract_signed, contract_date,
      has_whatsapp_group, evaluation, notes
    ) VALUES (
      '[TEST] Atlas Realty Casa', 'Karim Bensalah', '+212 6 61 23 45 67',
      'karim@test.stoniz.co', '12 Rue Allal Ben Abdellah, Casablanca',
      ARRAY['Gauthier','Maarif','Bourgogne'],
      'actif', true, CURRENT_DATE - 90,
      true, 3,
      'seed_test_2026_05_29 — Partenaire fictif pour tests internes'
    ) RETURNING id INTO v_partner_casa;
  ELSE
    SELECT id INTO v_partner_casa FROM partners
      WHERE notes LIKE '%' || v_seed_marker || '%' AND agency_name LIKE '%Atlas Realty%'
      LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM partners WHERE notes LIKE '%' || v_seed_marker || '%' AND agency_name LIKE '%Medina Properties%') THEN
    INSERT INTO partners (
      agency_name, contact_name, phone, email, address,
      quartiers_covered, status, contract_signed, contract_date,
      has_whatsapp_group, evaluation, notes
    ) VALUES (
      '[TEST] Medina Properties Marrakech', 'Sofia Tazi', '+212 6 62 34 56 78',
      'sofia@test.stoniz.co', 'Riad El Kantra, Médina, Marrakech',
      ARRAY['Médina','Gueliz','Palmeraie','Hivernage'],
      'actif', true, CURRENT_DATE - 45,
      true, 2,
      'seed_test_2026_05_29 — Partenaire fictif pour tests internes'
    ) RETURNING id INTO v_partner_marrakech;
  ELSE
    SELECT id INTO v_partner_marrakech FROM partners
      WHERE notes LIKE '%' || v_seed_marker || '%' AND agency_name LIKE '%Medina Properties%'
      LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM partners WHERE notes LIKE '%' || v_seed_marker || '%' AND agency_name LIKE '%Capital Estates%') THEN
    INSERT INTO partners (
      agency_name, contact_name, phone, email, address,
      quartiers_covered, status, contract_signed, contract_date,
      has_whatsapp_group, evaluation, notes
    ) VALUES (
      '[TEST] Capital Estates Rabat', 'Younes Lahlou', '+212 6 63 45 67 89',
      'younes@test.stoniz.co', '5 Avenue Mohammed V, Rabat',
      ARRAY['Agdal','Hassan','Souissi'],
      'prospect', false, NULL,
      false, 2,
      'seed_test_2026_05_29 — Partenaire fictif pour tests internes'
    ) RETURNING id INTO v_partner_rabat;
  ELSE
    SELECT id INTO v_partner_rabat FROM partners
      WHERE notes LIKE '%' || v_seed_marker || '%' AND agency_name LIKE '%Capital Estates%'
      LIMIT 1;
  END IF;

  -- ─── 6 AGENTS (2 par partenaire) ─────────────────────────────────────────

  INSERT INTO partner_agents (partner_id, name, phone, email, is_primary_contact, notes, started_at)
  SELECT v_partner_casa, 'Karim Bensalah', '+212 6 61 23 45 67', 'karim@test.stoniz.co', true, v_seed_marker, CURRENT_DATE - 90
  WHERE NOT EXISTS (
    SELECT 1 FROM partner_agents WHERE partner_id = v_partner_casa AND email = 'karim@test.stoniz.co'
  );

  INSERT INTO partner_agents (partner_id, name, phone, email, is_primary_contact, notes, started_at)
  SELECT v_partner_casa, 'Nadia Chraibi', '+212 6 71 11 22 33', 'nadia@test.stoniz.co', false, v_seed_marker, CURRENT_DATE - 60
  WHERE NOT EXISTS (
    SELECT 1 FROM partner_agents WHERE partner_id = v_partner_casa AND email = 'nadia@test.stoniz.co'
  );

  INSERT INTO partner_agents (partner_id, name, phone, email, is_primary_contact, notes, started_at)
  SELECT v_partner_marrakech, 'Sofia Tazi', '+212 6 62 34 56 78', 'sofia@test.stoniz.co', true, v_seed_marker, CURRENT_DATE - 45
  WHERE NOT EXISTS (
    SELECT 1 FROM partner_agents WHERE partner_id = v_partner_marrakech AND email = 'sofia@test.stoniz.co'
  );

  INSERT INTO partner_agents (partner_id, name, phone, email, is_primary_contact, notes, started_at)
  SELECT v_partner_marrakech, 'Mehdi Berrada', '+212 6 72 33 44 55', 'mehdi@test.stoniz.co', false, v_seed_marker, CURRENT_DATE - 30
  WHERE NOT EXISTS (
    SELECT 1 FROM partner_agents WHERE partner_id = v_partner_marrakech AND email = 'mehdi@test.stoniz.co'
  );

  INSERT INTO partner_agents (partner_id, name, phone, email, is_primary_contact, notes, started_at)
  SELECT v_partner_rabat, 'Younes Lahlou', '+212 6 63 45 67 89', 'younes@test.stoniz.co', true, v_seed_marker, CURRENT_DATE - 14
  WHERE NOT EXISTS (
    SELECT 1 FROM partner_agents WHERE partner_id = v_partner_rabat AND email = 'younes@test.stoniz.co'
  );

  INSERT INTO partner_agents (partner_id, name, phone, email, is_primary_contact, notes, started_at)
  SELECT v_partner_rabat, 'Imane Fassi', '+212 6 73 55 66 77', 'imane@test.stoniz.co', false, v_seed_marker, CURRENT_DATE - 7
  WHERE NOT EXISTS (
    SELECT 1 FROM partner_agents WHERE partner_id = v_partner_rabat AND email = 'imane@test.stoniz.co'
  );

  RAISE NOTICE 'Seed appliqué. Partenaires: % (Casa), % (Marrakech), % (Rabat)',
    v_partner_casa, v_partner_marrakech, v_partner_rabat;
END$$;

-- ─── Vérification ────────────────────────────────────────────────────────
SELECT id, agency_name, status, contract_signed, evaluation
FROM partners
WHERE notes LIKE '%seed_test_2026_05_29%'
ORDER BY created_at;

SELECT pa.name, pa.email, p.agency_name AS partner
FROM partner_agents pa
INNER JOIN partners p ON p.id = pa.partner_id
WHERE pa.notes = 'seed_test_2026_05_29'
ORDER BY p.agency_name, pa.name;

-- ============================================================================
-- CLEANUP — A exécuter quand tu as fini de tester pour tout supprimer.
-- Les partner_agents sont supprimés en cascade via ON DELETE CASCADE.
-- ============================================================================
/*

DELETE FROM partners WHERE notes LIKE '%seed_test_2026_05_29%';

-- Vérification post-cleanup (doit retourner 0 partenaires et 0 agents)
SELECT COUNT(*) AS partenaires_test_restants FROM partners WHERE notes LIKE '%seed_test_2026_05_29%';
SELECT COUNT(*) AS agents_test_restants FROM partner_agents WHERE notes = 'seed_test_2026_05_29';

*/
