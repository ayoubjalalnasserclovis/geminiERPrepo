-- artisans.type est NOT NULL avec un check sur 4 valeurs. Sans default, toute
-- création de prestataire (services, sourcing inline, etc.) qui oublie la
-- colonne plante avec « null value in column "type" of relation "artisans"
-- violates not-null constraint ». Default 'autre' = catch-all sans casser le
-- check existant ; les workflows métier qui connaissent le bon type continuent
-- de le surcharger explicitement.

ALTER TABLE public.artisans ALTER COLUMN type SET DEFAULT 'autre';

COMMENT ON COLUMN public.artisans.type IS
  'Type legacy (artisan_local / autre / entreprise_generale / fournisseur). Default ''autre'' depuis 2026-06-05 — la vraie classification métier passe par provider_type + business_scope.';
