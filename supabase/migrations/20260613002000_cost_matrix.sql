-- ============================================================================
-- Chantier 15 marathon — Matrice de coûts ménage (consultant U23/U24/U25,
-- décision CEO B7 : table de paramètres GLOBALE + override PAR LOGEMENT
-- + date d'effet).
--
-- PRINCIPE (convention n°1 — rien de calculé n'est stocké) :
--   On ne stocke QUE les coûts unitaires saisis (paramètres). Le coût d'un
--   ménage, la rentabilité par lot et la marge par action de gestion sont
--   DÉRIVÉS à la lecture par lib/propria/cost-matrix.ts.
--
-- HISTORISATION (pas d'updated_at — c'est voulu) :
--   Un changement de coût = NOUVELLE ligne avec une nouvelle date d'effet.
--   On ne modifie JAMAIS une valeur passée : les calculs de rentabilité
--   passés utilisent la valeur en vigueur À LA DATE du ménage. Une erreur de
--   saisie se corrige par soft-delete (deleted_at) + nouvelle ligne.
--
-- RÉSOLUTION d'un paramètre pour un lot U à une date D :
--   1. ligne scope='unit' du lot U la plus récente avec effective_from <= D
--   2. sinon ligne scope='global' la plus récente avec effective_from <= D
--   3. sinon NULL = donnée manquante (les dashboards affichent « en attente
--      de données », JAMAIS un faux zéro).
--
-- Idempotent. Ne PAS appliquer à la main : migration versionnée.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.propria_cost_params (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'global' = valeur par défaut pour tous les lots ; 'unit' = override d'un lot
  scope           text NOT NULL CHECK (scope IN ('global','unit')),
  propria_unit_id uuid REFERENCES public.propria_units(id) ON DELETE CASCADE,
  param_key       text NOT NULL CHECK (param_key IN (
    'mo_par_menage',
    'mo_par_deep_cleaning',
    'mo_par_poussiere',
    'linge_par_chambre',
    'linge_par_sdb',
    'blanchisserie_par_kg_ou_set',
    'amortissement_linge_par_menage',
    'consommables_par_menage',
    'transport_par_menage',
    'frais_gestion_par_menage'
  )),
  value_mad       numeric NOT NULL CHECK (value_mad >= 0),
  effective_from  date NOT NULL DEFAULT current_date,
  comment         text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  -- scope='unit' ⇔ propria_unit_id renseigné (et réciproquement)
  CONSTRAINT propria_cost_params_scope_unit_chk CHECK (
    (scope = 'unit'   AND propria_unit_id IS NOT NULL) OR
    (scope = 'global' AND propria_unit_id IS NULL)
  )
);

COMMENT ON TABLE public.propria_cost_params IS
  'Coûts unitaires ménage Propria (MAD) — paramètres SAISIS uniquement, tout coût calculé est dérivé à la lecture (lib/propria/cost-matrix.ts). Historisé par date d''effet : un changement = nouvelle ligne, jamais de modification d''une valeur passée (soft-delete si erreur de saisie). Décision CEO B7 : global + override par logement.';

COMMENT ON COLUMN public.propria_cost_params.scope IS
  '''global'' = défaut pour tous les lots · ''unit'' = override d''un lot précis (prime sur le global à la résolution).';
COMMENT ON COLUMN public.propria_cost_params.propria_unit_id IS
  'Lot concerné — obligatoire ssi scope=''unit'', NULL ssi scope=''global'' (CHECK).';
COMMENT ON COLUMN public.propria_cost_params.param_key IS
  'Clé du coût unitaire (tous en MAD) : '
  'mo_par_menage = main d''œuvre d''un ménage standard (avec arrivée, sans arrivée, post-propriétaire) · '
  'mo_par_deep_cleaning = main d''œuvre d''un Deep Cleaning · '
  'mo_par_poussiere = main d''œuvre d''un ménage Poussière · '
  'linge_par_chambre = coût linge (lavage/rotation du set) par CHAMBRE et par ménage · '
  'linge_par_sdb = coût linge (serviettes…) par SALLE DE BAIN et par ménage · '
  'blanchisserie_par_kg_ou_set = tarif blanchisserie unitaire (au kg ou au set) — valeur de RÉFÉRENCE saisie, pas encore injectée dans le coût d''un ménage faute de quantité kg/set mesurée par ménage · '
  'amortissement_linge_par_menage = amortissement du parc de linge par ménage · '
  'consommables_par_menage = produits + consommables d''accueil par ménage · '
  'transport_par_menage = déplacement de l''équipe par ménage · '
  'frais_gestion_par_menage = quote-part de frais de gestion par ménage.';
COMMENT ON COLUMN public.propria_cost_params.value_mad IS
  'Coût unitaire en MAD (>= 0). Tout est en MAD opérationnel — l''équivalent € (taux interne fixe lib/finance/fx-fixed.ts) n''est qu''un affichage de pilotage.';
COMMENT ON COLUMN public.propria_cost_params.effective_from IS
  'Date d''entrée en vigueur. Les ménages antérieurs à cette date continuent d''être valorisés avec l''ancienne ligne (historisation).';
COMMENT ON COLUMN public.propria_cost_params.deleted_at IS
  'Soft-delete uniquement (erreur de saisie). JAMAIS de hard-delete : audit + rollback.';

-- Résolution rapide : valeur applicable = la plus récente <= date demandée
CREATE INDEX IF NOT EXISTS idx_propria_cost_params_lookup
  ON public.propria_cost_params(param_key, scope, effective_from DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_propria_cost_params_unit
  ON public.propria_cost_params(propria_unit_id, param_key, effective_from DESC)
  WHERE deleted_at IS NULL;

-- ─── RLS : lecture staff · écriture CEO uniquement (paramétrage des coûts) ──
-- Le rôle developer passe par la Server Action vérifiée (assertRole) côté app.
ALTER TABLE public.propria_cost_params ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read cost params"  ON public.propria_cost_params;
DROP POLICY IF EXISTS "ceo insert cost params"  ON public.propria_cost_params;
DROP POLICY IF EXISTS "ceo update cost params"  ON public.propria_cost_params;
DROP POLICY IF EXISTS "ceo delete cost params"  ON public.propria_cost_params;
CREATE POLICY "staff read cost params" ON public.propria_cost_params
  FOR SELECT USING (public.is_staff());
CREATE POLICY "ceo insert cost params" ON public.propria_cost_params
  FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo']));
-- UPDATE n'est autorisé que pour poser deleted_at (soft-delete d'une erreur
-- de saisie) — on ne modifie jamais value_mad/effective_from d'une ligne.
CREATE POLICY "ceo update cost params" ON public.propria_cost_params
  FOR UPDATE USING (public.is_staff(ARRAY['ceo']))
  WITH CHECK (public.is_staff(ARRAY['ceo']));
CREATE POLICY "ceo delete cost params" ON public.propria_cost_params
  FOR DELETE USING (public.is_staff(ARRAY['ceo']));

NOTIFY pgrst, 'reload schema';
