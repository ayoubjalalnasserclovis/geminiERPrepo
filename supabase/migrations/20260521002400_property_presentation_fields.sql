-- ============================================================================
-- Champs additionnels properties pour la présentation client riche
-- ============================================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS badge_label TEXT,                       -- ex: "Division en 2"
  ADD COLUMN IF NOT EXISTS video_url TEXT,                          -- vidéo externe (YouTube, Vimeo, lien direct)
  ADD COLUMN IF NOT EXISTS avantages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS points_negatifs TEXT[] DEFAULT '{}',
  -- Charges & revenus annuels (EUR)
  ADD COLUMN IF NOT EXISTS charges_mensuelles_immeuble NUMERIC(14,2),  -- frais syndic, etc. (par mois)
  ADD COLUMN IF NOT EXISTS frais_fonctionnement_annuel NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS conciergerie_annuel NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS emprunt_mensuel NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS revenu_locatif_brut_annuel NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS taux_occupation NUMERIC(5,2),               -- en % (ex 82.19)
  ADD COLUMN IF NOT EXISTS impots_annuel NUMERIC(14,2);

COMMENT ON COLUMN properties.description IS 'Description longue présentée au client';
COMMENT ON COLUMN properties.badge_label IS 'Badge en haut de la présentation (ex: "Division en 2")';
COMMENT ON COLUMN properties.avantages IS 'Tags affichés en avantages';
COMMENT ON COLUMN properties.points_negatifs IS 'Tags affichés en points négatifs';
COMMENT ON COLUMN properties.taux_occupation IS 'Taux d''occupation locative en pourcentage';
