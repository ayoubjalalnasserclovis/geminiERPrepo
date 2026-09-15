-- ============================================================================
-- Relache la contrainte CHECK sur travaux_payments.category :
-- on autorise toutes les categories de lots travaux ET d'achats.
-- (avant : enum legacy 'gros_oeuvre','plomberie','electricite'... qui ne couvrait
--  pas les valeurs de travaux_lots.category comme 'gros_oeuvre_maconnerie',
--  ce qui faisait echouer l'insertion d'un acompte heritant de la categorie du lot)
-- ============================================================================

ALTER TABLE travaux_payments DROP CONSTRAINT IF EXISTS travaux_payments_category_check;
ALTER TABLE travaux_payments ADD CONSTRAINT travaux_payments_category_check
  CHECK (category IS NULL OR category IN (
    -- Anciennes valeurs (retro-compat)
    'gros_oeuvre','plomberie','electricite','menuiserie','peinture','deco','fournitures','autre',
    -- Categories de lots travaux
    'demolition_cloisons','gros_oeuvre_maconnerie','plomberie_sanitaire',
    'carrelage_revetements','menuiserie_interieure','menuiserie_aluminium',
    'faux_plafond','climatisation_vmc','ferronnerie',
    'amenagements_exterieurs','cuisine','divers',
    -- Categories de lots achats (au cas ou)
    'mobilier_salon','mobilier_chambre','mobilier_sdb','mobilier_cuisine',
    'electromenager','luminaire','textile_decoration',
    'vaisselle_arts_table','linge_maison',
    'plomberie_robinetterie','sanitaires','peinture_fournitures',
    'carrelage_marbre','menuiserie_fournitures',
    'jardinage_exterieur'
  ));

-- Idem pour achats_payments si la contrainte est trop restrictive
ALTER TABLE achats_payments DROP CONSTRAINT IF EXISTS achats_payments_category_check;
-- Pas de CHECK sur achats_payments.category par defaut (TEXT libre), on ne contraint pas.
