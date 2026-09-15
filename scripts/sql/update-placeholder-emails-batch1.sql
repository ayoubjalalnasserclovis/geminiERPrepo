-- ============================================================================
-- BATCH 1 : Mise à jour des emails placeholder → emails réels
-- ============================================================================
-- Source : CSV fourni par Othmane le 2026-05-29
-- 30 clients avec leur vrai email
--
-- Stratégie :
--   - Pour chaque ligne : si l'email cible existe déjà sur UN AUTRE client,
--     on merge les projets du placeholder vers l'existant puis on delete le placeholder.
--   - Sinon : simple UPDATE de l'email.
--   - Tout dans une transaction (BEGIN/COMMIT) → rollback automatique si erreur.
--
-- À exécuter dans le SQL editor Supabase.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  rec RECORD;
  existing_client_id UUID;
  merged_count INT := 0;
  updated_count INT := 0;
  not_found_count INT := 0;
BEGIN
  -- Liste source (id, email_cible) hardcodée depuis le CSV
  FOR rec IN
    SELECT * FROM (VALUES
      ('50fdc3f6-bc0a-4884-9573-c43f01877e53'::uuid, 'chadenizot@gmail.com'),
      ('6cc14d85-f09a-42e4-afc1-b2fe025f1aa8'::uuid, 'dwissou@icloud.com'),
      ('4bf0e9cc-7d2f-4bf7-a244-c8b49c12f040'::uuid, 'david.edith@free.fr'),
      ('ff990dbc-6693-47cf-ad26-b2e6fc80f3ff'::uuid, 'seelalaoui@yahoo.fr'),
      ('33c8f2ba-bd21-4803-9065-d746505a50ca'::uuid, 'patsourd@aol.com'),
      ('18f3129e-8b91-4192-abcb-6b7186721be6'::uuid, 'hajar.benbouja@gmail.com'),
      ('f034a468-5559-41be-908a-77c88eb66551'::uuid, 'boucheniata.hakim@gmail.com'),
      ('11f5121a-868e-4c47-9c43-f9db8f39ea76'::uuid, 'cedric.lebar@gmail.com'),
      ('6a1a5966-0f78-435a-9adc-317755689429'::uuid, 'jn.saunier@gmail.com'),
      ('8fc9d9b7-dd35-43b6-a1a1-f65d92d37f7b'::uuid, 'harratkacem@gmail.com'),
      ('d255407c-3375-4e98-baa7-ea6a2da85da6'::uuid, 'khalid.bouarich@yahoo.fr'),
      ('802d6745-b490-4da2-a0e9-eb747de00224'::uuid, 'edlahcen@hotmail.fr'),
      ('45107f6b-205c-40ea-b380-d77df43adc66'::uuid, 'falkamir@gmail.com'),
      ('65fd25eb-d07c-49fe-a707-f85014f855d8'::uuid, 'shazad_1@msn.com'),
      ('4d54b2e0-aa85-4cdb-ae40-5585f57add1c'::uuid, 'maxime.viotti@gmail.com'),
      ('dd9685c6-1117-4bc7-92f0-98dc8c5099ed'::uuid, 'moufekkir.nabil@gmail.com'),
      ('73a12057-f299-432d-9be7-166a45c6a93c'::uuid, 'contact@nathanpissaro.com'),
      ('44c40913-c96e-4d1b-bda5-9ffb32392b11'::uuid, 'haroun_78@hotmail.fr'),
      ('7f89071d-ec95-4126-ab44-6a409016ab6b'::uuid, 'rachid.boukkari@live.fr'),
      ('206c9694-a82c-48aa-9e0e-71fc33728afb'::uuid, 'foudadredha@gmail.com'),
      ('a69059ff-6ffb-4fbc-a31b-f47ec5c2b5ea'::uuid, 'richard.kandabile@gmail.com'),
      ('a1269ae5-9a68-452b-859d-bc7e35287956'::uuid, 'samiainnes10@gmail.com'),
      ('bad9eae6-c2bc-48f3-b4c4-9b53c43be242'::uuid, 'slimane.benbrahim@gmail.com'),
      ('99f74b95-f9bb-4a6c-ba5c-99c605648346'::uuid, 'smoussabbih@gmail.com'),
      ('d5cf5dcc-7087-45a4-a600-a30d2f9e64ae'::uuid, 'steven.lebourhis@gmail.com'),
      ('0707142c-1632-43a2-a76f-76fc1498f1af'::uuid, 'ducduy.n@gmail.com'),
      ('6c3d011f-4c30-424e-a22d-f1dabc94afd4'::uuid, 'hammoucheyamina@gmail.com'),
      ('7bcbde01-6600-4ddd-bdd4-d520cad5ef5c'::uuid, 'benchaiba.younes@gmail.com'),
      ('6bd6542a-bff4-4d21-af8d-062a894f5c7c'::uuid, 'b.yousri@gmail.com'),
      ('85dc7dba-2152-4195-824d-0999630becc1'::uuid, 'supdev.zakaria@gmail.com')
    ) AS t(client_id, new_email)
  LOOP
    -- Vérifier d'abord que le client placeholder existe (sécurité)
    IF NOT EXISTS (SELECT 1 FROM clients WHERE id = rec.client_id) THEN
      RAISE WARNING 'Client % introuvable, skip', rec.client_id;
      not_found_count := not_found_count + 1;
      CONTINUE;
    END IF;

    -- Chercher un client existant avec cet email (autre que le placeholder lui-même)
    SELECT id INTO existing_client_id
    FROM clients
    WHERE lower(email) = lower(rec.new_email)
      AND id <> rec.client_id
    LIMIT 1;

    IF existing_client_id IS NOT NULL THEN
      -- COLLISION : on merge les projets vers l'existant et on supprime le placeholder
      RAISE NOTICE 'COLLISION pour % → merge projects vers client existant %', rec.new_email, existing_client_id;

      UPDATE projects
      SET client_id = existing_client_id
      WHERE client_id = rec.client_id;

      DELETE FROM clients WHERE id = rec.client_id;
      merged_count := merged_count + 1;
    ELSE
      -- PAS de collision : simple UPDATE
      UPDATE clients
      SET email = rec.new_email
      WHERE id = rec.client_id;
      updated_count := updated_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'RÉSUMÉ :';
  RAISE NOTICE '  - % emails mis à jour (UPDATE simple)', updated_count;
  RAISE NOTICE '  - % clients fusionnés (collision)', merged_count;
  RAISE NOTICE '  - % clients introuvables (skip)', not_found_count;
  RAISE NOTICE '============================================';
END $$;

-- Vérification post-update : combien il reste de placeholders ?
SELECT
  COUNT(*) AS placeholders_restants
FROM clients
WHERE email LIKE 'import-%@no-email.stoniz.local';

COMMIT;
-- En cas de souci, remplace COMMIT par ROLLBACK et relance.
