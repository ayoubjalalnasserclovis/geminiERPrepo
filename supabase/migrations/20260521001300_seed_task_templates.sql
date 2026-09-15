-- ============================================================================
-- 13 — Seed task_templates (paliers de 10 pour insertions futures)
-- ============================================================================

INSERT INTO task_templates (phase, title, default_assigned_role, order_index, is_blocking) VALUES
-- ONBOARDING
('onboarding',       'Collecter la pièce d''identité / CIN',              'assistante',  10,  true),
('onboarding',       'Collecter la procuration signée',                    'assistante',  20,  true),
('onboarding',       'Faire signer le contrat de mission',                 'commercial',  30,  true),
('onboarding',       'Saisir le cahier des charges client',                'commercial',  40,  true),
('onboarding',       'Envoyer email de bienvenue + accès portail',         'assistante',  50,  false),
('onboarding',       'Encaisser acompte Stoniz (3 000 €)',                 'finance',     60,  true),
-- SOURCING
('sourcing',         'Sourcer des biens correspondant au cahier des charges', 'sourcing', 10, false),
('sourcing',         'Créer les fiches de proposition',                    'sourcing',    20,  false),
('sourcing',         'Envoyer les propositions au client',                 'sourcing',    30,  false),
('sourcing',         'Traiter les retours client (accepté/refusé)',        'sourcing',    40,  false),
('sourcing',         'Rédiger et envoyer l''offre d''achat',               'chef_projet', 50,  true),
('sourcing',         'Suivre jusqu''à signature compromis',                'chef_projet', 60,  true),
('sourcing',         'Encaisser 50% honoraires Stoniz (compromis)',        'finance',     70,  true),
('sourcing',         'Suivre jusqu''à acte authentique',                   'chef_projet', 80,  true),
-- DESIGN
('design',           'Envoyer les moodboards au client',                   'chef_projet', 10,  false),
('design',           'Valider le moodboard avec le client',                'chef_projet', 20,  true),
('design',           'Commander les plans 3D à l''architecte',             'chef_projet', 30,  true),
('design',           'Envoyer les 3D au client',                           'chef_projet', 40,  false),
('design',           'Valider les 3D avec le client',                      'chef_projet', 50,  true),
('design',           'Déposer demande de permis de travaux',               'chef_projet', 60,  true),
-- TRAVAUX
('travaux',          'Lancer le chantier avec les artisans',               'chef_projet', 10,  true),
('travaux',          'Verser acompte artisans (50% budget travaux)',       'finance',     20,  true),
('travaux',          'Effectuer point d''avancement hebdomadaire',         'chef_projet', 30,  false),
('travaux',          'Envoyer photos chantier au client',                  'chef_projet', 40,  false),
('travaux',          'Réception intermédiaire chantier',                   'chef_projet', 50,  true),
('travaux',          'Verser solde artisans à la livraison',               'finance',     60,  true),
('travaux',          'Encaisser solde honoraires Stoniz (livraison)',      'finance',     70,  true),
-- LIVRAISON
('livraison',        'Remise des clés au client / Stoniz',                 'chef_projet', 10,  true),
('livraison',        'Relever compteurs eau et électricité',               'chef_projet', 20,  true),
('livraison',        'Prendre les photos finales du bien',                 'chef_projet', 30,  false),
('livraison',        'Transférer le dossier à PROPRIA',                    'chef_projet', 40,  false),
('livraison',        'Envoyer notification de livraison au client',        'assistante',  50,  false),
-- MISE EN LOCATION
('mise_en_location', 'Créer les annonces Airbnb / Booking',                'chef_projet', 10,  false),
('mise_en_location', 'Intégrer le bien dans Hostaway',                     'chef_projet', 20,  false),
('mise_en_location', 'Faire signer le contrat de gestion PROPRIA',         'chef_projet', 30,  true),
('mise_en_location', 'Notifier le client du premier listing en ligne',     'assistante',  40,  false);
