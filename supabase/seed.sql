-- Seed minimal pour le dev local.
-- À exécuter après `supabase db reset`.
-- Crée un user CEO factice + un partenaire + un client + un bien.

-- ⚠ Pas de CEO créé automatiquement ici. Créer le compte CEO via :
--   Supabase Studio → Authentication → Users → "Add user"
--   Puis dans le SQL Editor :
--     UPDATE profiles SET role = 'ceo', full_name = 'Votre Nom' WHERE email = 'votre@email.com';

-- Partenaire factice
INSERT INTO partners (agency_name, contact_name, phone, status, evaluation, quartiers_covered, contract_signed)
VALUES (
  'Marrakech Premium Immo',
  'Hassan El Mansouri',
  '+212600000000',
  'actif',
  3,
  ARRAY['Gueliz','Hivernage','Palmeraie'],
  true
);

-- Pas de client / bien / projet seed pour préserver le contrôle utilisateur.
-- Pour créer rapidement un démo end-to-end, utiliser l'interface après login CEO :
--   1. /clients/new → créer un client (Jean Dupont, jean@test.fr)
--   2. /properties/new → créer un bien (Riad Bahia, Marrakech, 250 000 €)
--   3. /projects/new → créer un projet (lié au client)
--   4. /projects/[id]/proposals → envoyer le bien au client
--   5. Inviter le client au portail
--   6. Se connecter avec le compte client pour accepter la proposition
