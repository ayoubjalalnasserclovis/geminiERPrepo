/**
 * Mapping Notion → Supabase — constantes partagées par tous les sous-scripts.
 *
 * Modification d'une valeur ici (ex. nouveau Status Notion) → impact sur
 * tous les imports. Garder synchro avec docs/notion-import-procedure.md.
 */

// ─── IDs des databases Notion ─────────────────────────────────────────────
export const NOTION_DB_IDS = {
  partners:   '183e81d5bf518049ba11f54a9f8a40bb',
  properties: '310e31d9972b4718996850aec95d3cdc',
  clients:    '117e81d5bf51803eb851e93dd7026716',
} as const;

// ─── Mapping Status Notion CLIENTS → Supabase (current_phase, status) ─────
export type PhaseTuple = {
  phase: 'onboarding' | 'sourcing' | 'design' | 'travaux' | 'livraison' | 'mise_en_location' | 'termine';
  status: 'actif' | 'pause' | 'termine' | 'perdu';
  /**
   * Si true, la phase Supabase est déduite des dates remplies au lieu d'être fixe.
   * Utilisé pour Perdu et En pause (le statut tue le projet mais on garde la
   * trace de la phase d'où il est sorti).
   */
  deduceFromDates?: boolean;
};

export const NOTION_STATUS_TO_PHASE: Record<string, PhaseTuple> = {
  'Acompte':            { phase: 'onboarding',  status: 'actif' },
  'Onboarding':         { phase: 'onboarding',  status: 'actif' },
  'Recherche de bien':  { phase: 'sourcing',    status: 'actif' },
  'Offre':              { phase: 'sourcing',    status: 'actif' },
  'Compromis Fixer':    { phase: 'sourcing',    status: 'actif' },
  'Design':             { phase: 'design',      status: 'actif' },
  'Travaux':            { phase: 'travaux',     status: 'actif' },
  'Livré':              { phase: 'termine',     status: 'actif' },
  'Perdu':              { phase: 'sourcing',    status: 'perdu', deduceFromDates: true },
  'En pause':           { phase: 'onboarding',  status: 'pause', deduceFromDates: true },
};

// ─── Mapping Partner status Notion → Supabase ─────────────────────────────
// Statuts probables Notion (à valider à l'exécution — fallback 'prospect')
export const NOTION_PARTNER_STATUS: Record<string, 'actif' | 'inactif' | 'prospect'> = {
  'Actif':      'actif',
  'Inactif':    'inactif',
  'Prospect':   'prospect',
  'En cours':   'prospect',
  'Pas actif':  'inactif',
};

// ─── Mapping Contrat Partenariat (yes/no) ─────────────────────────────────
export const NOTION_PARTNER_CONTRACT_SIGNED: Record<string, boolean> = {
  'Signé':       true,
  'Oui':         true,
  'Yes':         true,
  'En cours':    false,
  'Non signé':   false,
  'Non':         false,
  'No':          false,
  'Partagé':     false, // contrat envoyé au partenaire mais pas formellement signé (flow non géré côté ERP)
};

// ─── Mapping Évaluation interne (étoiles) → INTEGER 1-3 ───────────────────
export const NOTION_EVAL_TO_INT: Record<string, number | null> = {
  '⭐':          1,
  '⭐⭐':        2,
  '⭐⭐⭐':      3,
  '1':          1,
  '2':          2,
  '3':          3,
  'Faible':     1,
  'Moyen':      2,
  'Excellent':  3,
};

// ─── Mapping Type bien Notion → Supabase enum ─────────────────────────────
export const NOTION_PROPERTY_TYPE: Record<string, 'Appartement' | 'Riad' | 'Terrain' | 'Villa' | null> = {
  'Appartement':  'Appartement',
  'Appartements': 'Appartement',
  'Appart':       'Appartement',
  'Apt':          'Appartement',
  'Riad':         'Riad',
  'Riads':        'Riad',
  'Terrain':      'Terrain',
  'Terrains':     'Terrain',
  'Villa':        'Villa',
  'Villas':       'Villa',
};

// ─── Mapping Mode signature Notion → Supabase enum ────────────────────────
export const NOTION_SIGNATURE_MODE: Record<string, 'distance' | 'presentiel' | null> = {
  'Distance':       'distance',
  'À distance':     'distance',
  'En présentiel':  'presentiel',
  'Présentiel':     'presentiel',
};

// ─── Mapping Crédit Notion → Supabase enum ────────────────────────────────
export const NOTION_CREDIT_TYPE: Record<string, 'yes' | 'no' | 'islamic' | null> = {
  'Oui':                  'yes',
  'Non':                  'no',
  'Islamique':            'islamic',
  'Crédit Islamique':     'islamic',
  'Islamique uniquement': 'islamic',
  'Islamique seulement':  'islamic',
  'Pas de crédit':        'no',
};

// ─── Champs files Notion CLIENTS → type document Supabase ─────────────────
// (Pour le sous-script documents — L6, pas encore implémenté)
export const NOTION_FILE_FIELDS_TO_DOC_TYPE: Record<string, string> = {
  'Pièce d\'identité':            'piece_identite',
  'CIN':                           'cin',
  'Contrat ':                      'contrat_mission',
  'Compromis ':                    'compromis',
  'Titre foncier':                 'titre_foncier',
  'Autorisation travaux':          'autorisation_travaux',
  'Dossier Architecture':          'dossier_architecture',
  'Scan procuration':              'procuration',
  'demande de permis':             'permis_travaux',
  'Compteurs eau et electricité ': 'contrat_eau', // sera dupliqué pour électricité
};

// ─── Champs files Notion BIENS → type media Supabase ──────────────────────
export const NOTION_FILE_FIELDS_TO_MEDIA_TYPE: Record<string, string> = {
  'Vidéo du bien':                'video_bien',
  'Vidéo de la façade':           'video_facade',
  'Vidéo des parties communes':   'video_parties_communes',
  'Fichiers et médias':           'photo',
};

// ─── Champs ignorés (doublons / fossiles validés par le CEO) ──────────────
export const NOTION_CLIENT_FIELDS_IGNORED = new Set([
  'Signature ',                      // doublon de Signature compromis / acte
  'Compromis',                       // formula dérivée
  'budget',                          // doublon rich_text de Budget select
  'Autorisation de travaux (1) 1',   // doublon date
  'demande de permis 1',             // doublon files
  'procuration',                     // doublon de Scan procuration
  'Sélectionner',                    // champ vague obsolète
  'Sélectionner (1)',                // champ vague obsolète
  'Taux d\'acceptation',             // formula
  'Délai depuis onboarding',         // formula
  'Montant des travaux',             // rollup
  'Moodboards',                      // multi_select interne, non importé pour l'instant
  'Satisfaction',                    // select, à voir si importé en projects
  '📏 BET - Axel Engeniring ',        // relation BET, hors scope
]);
