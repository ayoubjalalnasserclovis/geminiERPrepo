/**
 * Mapper CSV format "MASTER ERP" → format BDD natif.
 *
 * Le CSV MASTER ERP est l'export d'un Google Sheets historique avec 44 colonnes
 * (cost_bien, surface, loyer_brut_mensuel, etc.). Cet helper :
 *   1. Détecte si un CSV est au format MASTER ERP via ses en-têtes.
 *   2. Transforme chaque ligne en objet compatible avec le parser CSV natif
 *      existant (name, type, quartier, superficie, price, etc.).
 *
 * Seuls les INPUTS sont importés. Tous les champs calculés du CSV
 * (total_cost, rendement_brut, cost_notaire, etc.) sont ignorés —
 * ils seront recalculés par lib/finance/property-calc.ts.
 */

// ─── Détection format ───────────────────────────────────────────────────────

/**
 * Renvoie true si les en-têtes correspondent au format MASTER ERP.
 * Critère : présence simultanée de plusieurs colonnes typiques du legacy.
 */
export function isMasterErpFormat(headers: string[]): boolean {
  const set = new Set(headers.map(h => h.trim().toLowerCase()));
  // 3 signatures fortes du format legacy
  const sig = ['cost_bien', 'loyer_brut_mensuel', 'surface'];
  return sig.every(s => set.has(s));
}

// ─── Helpers parsing ────────────────────────────────────────────────────────

/**
 * Convertit "264 765 €" / "19,24%" / "3 795 €" en nombre.
 * Renvoie null si vide ou invalide.
 */
function parseLegacyNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = String(v)
    .replace(/[€%$£\s]/g, '')   // unités et espaces
    .replace(/[  ]/g, '') // espaces insécables
    .replace(',', '.')
    .trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Strip HTML tags pour la description. */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Mappe type_projet legacy → ALLOWED_TYPES. */
function mapType(rawType: string): string {
  const t = (rawType || '').trim().toLowerCase();
  if (t.includes('appart') || t.includes('division') || t === '' || t.includes('immeuble')) return 'Appartement';
  if (t.includes('riad')) return 'Riad';
  if (t.includes('villa')) return 'Villa';
  if (t.includes('terrain')) return 'Terrain';
  return 'Appartement'; // fallback raisonnable
}

// ─── Mapping principal ──────────────────────────────────────────────────────

export type NativeImportRow = {
  // Colonnes minimales du format natif. Toutes les valeurs sont des strings
  // (comme si elles venaient d'un CSV), pour rester compatible avec le parser
  // existant qui fait son propre num() à la fin.
  name: string;
  type: string;
  quartier: string;
  address: string;
  google_maps_url: string;
  superficie: string;
  terrasse_m2: string;
  floor: string;
  nb_suites: string;
  evaluation: string;
  status: string;
  // ATTENTION sémantique (CEO 2026-06-18) :
  //   - initial_asking_price = premier prix obtenu (sourcing, vendeur initial)
  //   - price                = prix retenu après négociation (à saisir à la main)
  // L'import legacy MASTER ERP utilisait cost_bien → price, ce qui était faux :
  // cost_bien est par définition le PREMIER prix → initial_asking_price.
  initial_asking_price: string;
  price: string;
  estimated_rent: string;
  travaux_budget_estimate: string;
  description: string;
  charges_mensuelles_immeuble: string;
  taux_occupation: string;
  frais_fonctionnement_annuel: string;
  conciergerie_annuel: string;
  // Champs optionnels
  notary_fees: string;     // vide → auto 7%
  agency_fees: string;     // vide → auto 3%
  nb_lots_residence: string;
  emprunt_mensuel: string;
  impots_annuel: string;
  video_url: string;
  avantages: string;
  points_negatifs: string;
};

/**
 * Transforme une ligne du CSV MASTER ERP en objet compatible
 * avec le parser CSV natif.
 *
 * @param row dict header → valeur (string brute du CSV)
 */
export function mapMasterErpRow(row: Record<string, string>): NativeImportRow {
  const g = (k: string): string => (row[k] ?? '').trim();
  const num = (k: string): string => {
    const n = parseLegacyNumber(g(k));
    return n != null ? String(n) : '';
  };

  // Nom : prend nom_bien si présent, sinon name. Nettoie les annotations type
  // "117 m2 anbar - 120m2 - Gueliz" → "117 m2 Anbar".
  const rawName = g('nom_bien') || g('name');
  const cleanedName = rawName.split('-')[0].trim() || rawName;

  // Description : on concatène courte + longue (HTML strippé)
  const descShort = stripHtml(g('description_courte'));
  const descLong = stripHtml(g('description_du_bien'));
  const description = [descShort, descLong].filter(Boolean).join('\n\n');

  // cost_emprunt est annuel dans le CSV → mensuel pour la BDD
  const empruntAnnuel = parseLegacyNumber(g('cost_emprunt'));
  const empruntMensuel = empruntAnnuel != null ? String(Math.round(empruntAnnuel / 12)) : '';

  return {
    name: cleanedName,
    type: mapType(g('type_projet')),
    quartier: g('quartier') || '—',
    // address pas dans MASTER ERP → on met une valeur de remplissage
    // (le chasseur devra compléter depuis la fiche après import)
    address: g('address') || 'À compléter',
    google_maps_url: g('google_maps') || g('google_maps_url'),
    superficie: num('surface'),
    terrasse_m2: '0', // pas dans MASTER ERP
    floor: g('floor') || 'À préciser',
    nb_suites: num('number_division') || '0',
    evaluation: '2', // 2/3 par défaut, le user ajustera
    status: 'sourcing', // toujours en brouillon
    // CEO 2026-06-18 : cost_bien (CSV) = premier prix obtenu → initial_asking_price.
    // CEO 2026-06-19 : on initialise AUSSI price à la même valeur (hypothèse :
    // pas encore négocié au moment de l'import legacy → premier prix = prix
    // de référence). Le user pourra modifier price à la main après négociation.
    // Sans ça, le parser rejetait toutes les lignes MASTER ERP avec "Prix
    // obligatoire (>0)" — régression du commit 4dbf614 qui cassait Chakib (Jacaranda)
    // et tous les imports MASTER ERP depuis le 18/06.
    initial_asking_price: num('cost_bien'),
    price: num('cost_bien'),
    estimated_rent: num('loyer_brut_mensuel'),
    // travaux_budget_estimate : le helper le recalcule (425/m² + 7000/suite)
    // mais on importe quand même la valeur legacy au cas où
    travaux_budget_estimate: num('cost_travaux'),
    description,
    charges_mensuelles_immeuble: num('frais_copropriete'),
    taux_occupation: num('taux_occupation') || '75.62',
    frais_fonctionnement_annuel: num('cost_fonctionnement'),
    conciergerie_annuel: num('cost_conciergerie'),
    // notary_fees / agency_fees vides → auto 7% / 3% par le helper
    notary_fees: '',
    agency_fees: '',
    nb_lots_residence: num('number_lots'),
    emprunt_mensuel: empruntMensuel,
    impots_annuel: num('cost_impot'),
    video_url: g('video_drive') || g('video_url'),
    avantages: '',
    points_negatifs: '',
  };
}

// ─── Détection doublons ────────────────────────────────────────────────────

/**
 * Normalise un nom de bien pour la détection de doublons.
 * Strip casse, accents, "m2", "m²", tirets, espaces multiples.
 */
export function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[  ]/g, ' ')                   // espaces insécables
    .replace(/m[²2]/g, '')                              // m² ou m2
    .replace(/[-_.,;:'"()/\\]/g, ' ')                   // ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trouve un bien existant qui matche le nom donné.
 * Match si :
 *   - Noms normalisés identiques, OU
 *   - L'un est inclus dans l'autre (préfixe ou suffixe substantiel)
 */
export function findDuplicateName(
  newName: string,
  existingNames: string[],
): string | null {
  const norm = normalizeNameForMatch(newName);
  if (!norm) return null;
  // Tokens significatifs (> 2 chars)
  const tokens = norm.split(' ').filter(t => t.length > 2);
  if (tokens.length === 0) return null;

  for (const existing of existingNames) {
    const existingNorm = normalizeNameForMatch(existing);
    if (!existingNorm) continue;
    if (norm === existingNorm) return existing;
    // Si tous les tokens du nouveau sont dans l'existant (ou inverse)
    const existingTokens = new Set(existingNorm.split(' '));
    const allInExisting = tokens.every(t => existingTokens.has(t));
    if (allInExisting) return existing;
    const newTokens = new Set(norm.split(' '));
    const existingTokensList = existingNorm.split(' ').filter(t => t.length > 2);
    const allInNew = existingTokensList.every(t => newTokens.has(t));
    if (allInNew && existingTokensList.length >= 2) return existing;
  }
  return null;
}
