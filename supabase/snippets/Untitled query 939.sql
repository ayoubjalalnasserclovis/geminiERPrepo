ALTER TABLE travaux_payments DROP CONSTRAINT IF EXISTS travaux_payments_category_check;
ALTER TABLE travaux_payments ADD CONSTRAINT travaux_payments_category_check
  CHECK (category IS NULL OR category IN (
    'gros_oeuvre','plomberie','electricite','menuiserie','peinture','deco','fournitures','autre',
    'demolition_cloisons','gros_oeuvre_maconnerie','plomberie_sanitaire',
    'carrelage_revetements','menuiserie_interieure','menuiserie_aluminium',
    'faux_plafond','climatisation_vmc','ferronnerie',
    'amenagements_exterieurs','cuisine','divers',
    'mobilier_salon','mobilier_chambre','mobilier_sdb','mobilier_cuisine',
    'electromenager','luminaire','textile_decoration',
    'vaisselle_arts_table','linge_maison',
    'plomberie_robinetterie','sanitaires','peinture_fournitures',
    'carrelage_marbre','menuiserie_fournitures',
    'jardinage_exterieur'
  ));

NOTIFY pgrst, 'reload schema';