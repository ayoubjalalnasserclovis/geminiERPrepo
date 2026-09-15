-- ============================================================================
-- Base de donnees ARTISANS (societes / personnes physiques)
-- + extension de documents pour devis_artisan / facture_artisan rattaches a un lot
-- ============================================================================

CREATE TABLE IF NOT EXISTS artisans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  name TEXT NOT NULL,                              -- nom commercial / raison sociale
  legal_form TEXT CHECK (legal_form IN (
    'personne_physique','sarl','sa','sas','sci','auto_entrepreneur','autre'
  )),
  type TEXT NOT NULL CHECK (type IN (
    'artisan_local','entreprise_generale','sous_traitant_ext','autre'
  )),
  speciality TEXT CHECK (speciality IN (
    'demolition_cloisons','gros_oeuvre_maconnerie','electricite','plomberie_sanitaire',
    'carrelage_revetements','menuiserie_interieure','menuiserie_aluminium',
    'peinture','faux_plafond','climatisation_vmc','ferronnerie',
    'amenagements_exterieurs','cuisine','divers','multi_corps_etat'
  )),

  -- Donnees societe / fiscales
  ice TEXT,                                        -- ICE Maroc (15 chiffres)
  rc TEXT,                                         -- Registre de commerce
  if_number TEXT,                                  -- Identifiant fiscal
  patente TEXT,                                    -- N° patente
  cnss TEXT,                                       -- N° CNSS

  -- Contact
  contact_name TEXT,                               -- Nom du contact principal
  phone TEXT,
  email TEXT,
  whatsapp TEXT,

  -- Adresse
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'Maroc',

  -- Bancaire (pour reglements)
  bank_name TEXT,
  rib TEXT,                                        -- RIB Maroc (24 chiffres)

  -- Suivi commercial / qualite
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','inactif','blacklist','prospect')),
  evaluation INTEGER CHECK (evaluation BETWEEN 1 AND 5),
  notes TEXT,

  -- KPIs derivees (alimentees a la demande, pas via trigger pour eviter latence)
  nb_lots_total INTEGER NOT NULL DEFAULT 0,
  ca_total_mad NUMERIC(14,2) NOT NULL DEFAULT 0,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS artisans_ice_uniq
  ON artisans (ice) WHERE ice IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS artisans_status_speciality_idx
  ON artisans (status, speciality) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS artisans_name_search_idx
  ON artisans USING gin (to_tsvector('french', name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER artisans_set_updated_at BEFORE UPDATE ON artisans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Lien optionnel travaux_lots → artisans ─────────────────────────────────
-- On garde artisan_name TEXT pour la retro-compatibilite, mais on permet de
-- rattacher un lot a un artisan de la base.
ALTER TABLE travaux_lots
  ADD COLUMN IF NOT EXISTS artisan_id UUID REFERENCES artisans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS travaux_lots_artisan_idx
  ON travaux_lots (artisan_id) WHERE deleted_at IS NULL;

-- ─── Extension documents : devis_artisan, facture_artisan + lot_id ─────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES travaux_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artisan_id UUID REFERENCES artisans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_mad NUMERIC(14,2),                       -- montant du devis/facture
  ADD COLUMN IF NOT EXISTS document_number TEXT,                           -- n° devis ou facture
  ADD COLUMN IF NOT EXISTS document_date DATE;                             -- date du document

CREATE INDEX IF NOT EXISTS documents_lot_idx
  ON documents (lot_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_artisan_idx
  ON documents (artisan_id) WHERE deleted_at IS NULL;

-- Etend la liste des types de documents
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'contrat_mission','compromis','plans_3d','lots_techniques','shopping_list',
    'permis_travaux','photos_chantier','pv_livraison','contrat_gestion_propria',
    'autorisation_travaux','titre_foncier','dossier_architecture',
    'contrat_eau','contrat_electricite','contrat_assurance','contrat_internet',
    'piece_identite','cin','rib','procuration','justificatif_financement',
    'devis_artisan','facture_artisan',
    'autre'
  ));

-- ─── RLS artisans (staff uniquement) ───────────────────────────────────────
ALTER TABLE artisans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artisans_staff_all ON artisans;
CREATE POLICY artisans_staff_all ON artisans
  FOR ALL
  USING (is_staff(ARRAY['ceo','chef_projet','finance','assistante']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','finance','assistante']));

COMMENT ON TABLE artisans IS
  'Base de donnees des artisans/societes prestataires. Reutilisable entre projets.';
COMMENT ON COLUMN documents.lot_id IS
  'Si le document est rattache a un lot de travaux (devis ou facture artisan).';
COMMENT ON COLUMN documents.artisan_id IS
  'Si le document est emis par un artisan donne.';
COMMENT ON COLUMN documents.amount_mad IS
  'Montant du devis ou de la facture (MAD).';
